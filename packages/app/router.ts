import { apiVersion, definitions, describe, failure, requestSchema, version, workerOperations, liveOperations } from '../contracts/protocol.ts';
import type { Credential, Request, Response,Scope } from '../contracts/protocol.ts';
import { UpdateService } from '../update/service.ts';
import { UpdateError } from '../update/ports.ts';
import { AccessError, AccessService } from '../modules/access/service.ts';
import type { Principal } from '../modules/access/service.ts';
import { ConfigurationError, SourceConfiguration } from './source-configuration.ts';
import type { ActorRef } from '../modules/persistence/stage3-ports.ts';
import { readStaticHelp } from '../contracts/help.ts';
import { summarize } from '../modules/diagnostics/service.ts';
import type { DiagnosticCheck } from '../modules/diagnostics/service.ts';
import { AppearancePreview } from './appearance-preview.ts';
import { Stage3Error } from '../modules/persistence/stage3-ports.ts';

export interface DesktopPort { show(): void; quit(finalGuard: () => void): void; status(): Record<string, unknown>;openDataDirectory?:()=>Promise<void> }

export interface HostRuntime { invoke(request: Request,actor?:ActorRef): Promise<Response>; health(): Record<string, unknown> }
export class HostRouter {
  private access: AccessService;
  private runtime: HostRuntime;
  private identity: { runtimeId: string; handlerInstanceId: string };
  private stopping = false;
  private mode: 'fixture' | 'live-readonly';
  private updates?: UpdateService;
  private desktop?: DesktopPort;
  private configuration?: SourceConfiguration;
  private quitKeys = new Map<string, string>();
  private appearance?:AppearancePreview;
  constructor(access: AccessService, runtime: HostRuntime, identity: HostRouter['identity'], mode: 'fixture' | 'live-readonly' = 'fixture', updates?: UpdateService, platform?: { desktop: DesktopPort; configuration: SourceConfiguration;appearance?:AppearancePreview }) { this.access = access; this.runtime = runtime; this.identity = identity; this.mode = mode; this.updates = updates; this.desktop = platform?.desktop; this.configuration = platform?.configuration;this.appearance=platform?.appearance; }
  setStartupMode(mode: 'fixture' | 'live-readonly') { this.mode = mode; }
  stop() { this.stopping = true; }
  private available(name: string) { return !(name.startsWith('updates.') && name !== 'updates.status' && !this.updates?.status().supported); }
  async invoke(raw: unknown, context: { trustedDesktop: true } | { credential?: Credential }): Promise<Response> {
    const requestId = raw && typeof raw === 'object' && 'requestId' in raw && typeof raw.requestId === 'string' ? raw.requestId : 'unassigned';
    if (raw && typeof raw === 'object' && 'apiVersion' in raw && raw.apiVersion !== apiVersion) return failure('PROTOCOL_INCOMPATIBLE', 'API major 不兼容', requestId);
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) return failure('INVALID_ARGUMENT', '请求结构无效', requestId);
    const request = parsed.data;
    if (this.stopping) return failure('APP_STOPPING', '应用正在退出', request.requestId);
    try {
      const definition = definitions.find(item => item.operation === request.operation);
      if (!definition) return failure('CAPABILITY_UNSUPPORTED', '该能力尚未实现', request.requestId);
      const params = definition.input.safeParse(request.params);
      if (!params.success) return failure('INVALID_ARGUMENT', '参数不符合能力契约', request.requestId);
      let data: Record<string, unknown>;
      if(request.operation.startsWith('help.')){data=readStaticHelp(request.operation,params.data);}
      else if (request.operation === 'access.request') {
        if ('trustedDesktop' in context || !context.credential) return failure('AUTH_REQUIRED', '请由独立客户端申请配对', request.requestId);
        data = await this.access.request(context.credential, params.data as { clientLabel: string; requestedScopes: Scope[] }, request.idempotencyKey);
      } else {
        const actor: Principal = 'trustedDesktop' in context ? { kind: 'desktop', clientId: 'desktop', revision: 1, scopes: ['read', 'access.manage', 'app.manage','settings.manage'] } : this.access.authenticate(context.credential);
        this.access.assertCurrent(actor, definition.scope);
        if(request.operation==='appearance.preview'||request.operation==='appearance.cancelPreview'||request.operation==='appearance.get'&&this.appearance){
          if(!this.appearance)return failure('CAPABILITY_UNSUPPORTED','窗口预览未组装',requestId);
          const guard=()=>{if(this.stopping)throw new Stage3Error('APP_STOPPING','应用正在退出');this.access.assertCurrent(actor,definition.scope);};
          data=request.operation==='appearance.get'?await this.appearance.get(guard):request.operation==='appearance.preview'?await this.appearance.preview(params.data,actor,request.idempotencyKey,guard):this.appearance.cancel(String((params.data as {previewId:string}).previewId),actor,guard);
        }
        else if (workerOperations.has(request.operation)) {
          const result = await this.runtime.invoke(request,{kind:actor.kind,clientId:actor.clientId,revision:actor.revision,canManageOperations:actor.scopes.includes('app.manage')});
          if(definition.readOnly)this.access.assertCurrent(actor,definition.scope);
          if(result.ok&&(request.operation==='appearance.update'||request.operation==='settings.update'&&(params.data as {section?:string}).section==='appearance'))try{await this.appearance?.savedChanged();}catch{/* 已提交的设置不因窗口同步失败冒充保存失败；下一次读取重新应用。 */}
          if(result.ok&&request.operation==='diagnostics.run'){
            const health=this.runtime.health();const checks=[...(result.data.checks as DiagnosticCheck[]),{id:'worker',status:health.state==='running'?'passed':'unknown',reason:String(health.reason??health.state),source:'local'},{id:'authorization',status:'passed',reason:'current_read_authorization',source:'local'}] as DiagnosticCheck[];
            return {...result,data:{...result.data,checks,status:summarize(checks),hostState:health.state}};
          }
          return result;
        }
        else if (request.operation === 'connections.configuration') { if (!this.configuration) return failure('CAPABILITY_UNSUPPORTED', '来源配置未组装', requestId); data = this.configuration.get(); }
        else if (request.operation === 'connections.configure') { if (!this.configuration) return failure('CAPABILITY_UNSUPPORTED', '来源配置未组装', requestId); data = await this.configuration.configure(params.data, actor.clientId, request.idempotencyKey, () => { if (this.stopping) throw new ConfigurationError('APP_STOPPING', '应用正在退出'); this.access.assertCurrent(actor, 'app.manage'); }); }
        else if (request.operation === 'desktop.status') {if(!this.desktop)return failure('CAPABILITY_UNSUPPORTED','桌面未组装',requestId);data={...this.desktop.status(),supported:true};}
        else if (request.operation === 'desktop.openDataDirectory') {if(!this.desktop?.openDataDirectory)return failure('CAPABILITY_UNSUPPORTED','固定目录入口未组装',requestId);this.access.assertCurrent(actor,'app.manage');await this.desktop.openDataDirectory();data={opened:true};}
        else if (request.operation === 'desktop.show') { if (!this.desktop) return failure('CAPABILITY_UNSUPPORTED', '桌面未组装', requestId); this.desktop.show(); data = { shown: true }; }
        else if (request.operation === 'app.quit') {
          if (!this.desktop) return failure('CAPABILITY_UNSUPPORTED', '桌面未组装', requestId);
          if (!request.idempotencyKey) return failure('INVALID_ARGUMENT', '退出必须携带幂等键', requestId);
          if ((params.data as { expectedInstanceId: string }).expectedInstanceId !== this.identity.runtimeId) return failure('REVISION_CONFLICT', '应用实例已变化', requestId);
          const key = actor.clientId + ':' + request.idempotencyKey; const body = JSON.stringify(params.data);
          if (this.quitKeys.has(key) && this.quitKeys.get(key) !== body) return failure('IDEMPOTENCY_CONFLICT', '同键退出参数不一致', requestId);
          if (!this.quitKeys.has(key)) { this.access.assertCurrent(actor, 'app.manage'); this.quitKeys.set(key, body); this.desktop.quit(() => this.access.assertCurrent(actor, 'app.manage')); }
          data = { accepted: true, instanceId: this.identity.runtimeId };
        }
        else if (request.operation === 'app.status') data = { state: this.runtime.health().state, mode: this.mode, instanceId: this.identity.runtimeId, ...this.desktop?.status(), realCodexConnected: this.mode === 'live-readonly' && (this.runtime.health().provider as { state?: string } | undefined)?.state === 'ready', ...this.runtime.health() };
        else if (request.operation === 'app.version') data = { version, apiVersion };
        else if (request.operation === 'capabilities.list') data = { capabilities: definitions.map(d => ({ ...describe(d.operation), available: this.available(d.operation), allowed: d.scope==='public'||actor.scopes.includes(d.scope as Scope) })) };
        else if (request.operation === 'capabilities.describe') { const name = String((params.data as { operation: string }).operation); data = describe(name) ? { ...describe(name), available: this.available(name) } : { available: false }; }
        else if (request.operation.startsWith('updates.')) {
          if (!this.updates) return failure('UPDATE_UNSUPPORTED', '更新模块未组装', request.requestId);
          if (request.operation === 'updates.status') data = this.updates.status();
          else if (request.operation === 'updates.check') data = await this.updates.check();
          else data = await this.updates.request(request.operation === 'updates.download' ? 'download' : 'install', actor.clientId, params.data as Parameters<UpdateService['request']>[2], request.idempotencyKey, () => this.access.assertCurrent(actor, 'app.manage'));
        }
        else if (request.operation === 'access.list') data = this.access.list(actor);
        else if (request.operation === 'access.grant') data = await this.access.grant(actor, params.data as Parameters<AccessService['grant']>[1], request.idempotencyKey);
        else if (request.operation === 'access.revoke') {data = await this.access.revoke(actor, params.data as Parameters<AccessService['revoke']>[1], request.idempotencyKey);this.appearance?.revoke(String((params.data as {id:string}).id));}
        else return failure('CAPABILITY_UNSUPPORTED', '该能力尚未实现', request.requestId);
        if (definition.readOnly) this.access.assertCurrent(actor, definition.scope);
      }
      return { ok: true, data, meta: { apiVersion, requestId: request.requestId, source: 'local', ...this.identity, workerPid: this.runtime.health().workerPid as number | null } };
    } catch (error) { return failure(error instanceof AccessError || error instanceof UpdateError || error instanceof ConfigurationError || error instanceof Stage3Error ? error.code : 'INTERNAL_ERROR', error instanceof AccessError || error instanceof UpdateError || error instanceof ConfigurationError || error instanceof Stage3Error ? error.message : '请求处理失败', request.requestId); }
  }
}
