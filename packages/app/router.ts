import { apiVersion, definitions, describe, failure, requestSchema, version, workerOperations, liveOperations } from '../contracts/protocol.ts';
import type { Credential, Request, Response } from '../contracts/protocol.ts';
import { UpdateService } from '../update/service.ts';
import { UpdateError } from '../update/ports.ts';
import { AccessError, AccessService } from '../modules/access/service.ts';
import type { Principal } from '../modules/access/service.ts';
import { ConfigurationError, SourceConfiguration } from './source-configuration.ts';

export interface DesktopPort { show(): void; quit(finalGuard: () => void): void; status(): Record<string, unknown> }

export interface HostRuntime { invoke(request: Request): Promise<Response>; health(): Record<string, unknown> }
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
  constructor(access: AccessService, runtime: HostRuntime, identity: HostRouter['identity'], mode: 'fixture' | 'live-readonly' = 'fixture', updates?: UpdateService, platform?: { desktop: DesktopPort; configuration: SourceConfiguration }) { this.access = access; this.runtime = runtime; this.identity = identity; this.mode = mode; this.updates = updates; this.desktop = platform?.desktop; this.configuration = platform?.configuration; }
  setStartupMode(mode: 'fixture' | 'live-readonly') { this.mode = mode; }
  stop() { this.stopping = true; }
  private available(name: string) { return !(this.mode === 'fixture' && liveOperations.has(name)) && !(name.startsWith('updates.') && name !== 'updates.status' && !this.updates?.status().supported); }
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
      if (request.operation === 'access.request') {
        if ('trustedDesktop' in context || !context.credential) return failure('AUTH_REQUIRED', '请由独立客户端申请配对', request.requestId);
        data = await this.access.request(context.credential, params.data as { clientLabel: string; requestedScopes: Array<'read' | 'access.manage' | 'app.manage'> }, request.idempotencyKey);
      } else {
        const actor: Principal = 'trustedDesktop' in context ? { kind: 'desktop', clientId: 'desktop', revision: 1, scopes: ['read', 'access.manage', 'app.manage'] } : this.access.authenticate(context.credential);
        this.access.assertCurrent(actor, definition.scope);
        if (workerOperations.has(request.operation)) {
          if (this.mode === 'fixture' && liveOperations.has(request.operation)) return failure('PROVIDER_UNAVAILABLE', '该读取要求显式启动 live-readonly 模式', request.requestId);
          const result = await this.runtime.invoke(request); this.access.assertCurrent(actor, 'read'); return result;
        }
        if (request.operation === 'connections.configuration') { if (!this.configuration) return failure('CAPABILITY_UNSUPPORTED', '来源配置未组装', requestId); data = this.configuration.get(); }
        else if (request.operation === 'connections.configure') { if (!this.configuration) return failure('CAPABILITY_UNSUPPORTED', '来源配置未组装', requestId); data = await this.configuration.configure(params.data, actor.clientId, request.idempotencyKey, () => { if (this.stopping) throw new ConfigurationError('APP_STOPPING', '应用正在退出'); this.access.assertCurrent(actor, 'app.manage'); }); }
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
        else if (request.operation === 'capabilities.list') data = { capabilities: definitions.map(d => ({ ...describe(d.operation), available: this.available(d.operation), allowed: actor.scopes.includes(d.scope as 'read' | 'access.manage' | 'app.manage') })) };
        else if (request.operation === 'capabilities.describe') { const name = String((params.data as { operation: string }).operation); data = describe(name) ? { ...describe(name), available: this.available(name) } : { available: false }; }
        else if (request.operation.startsWith('updates.')) {
          if (!this.updates) return failure('UPDATE_UNSUPPORTED', '更新模块未组装', request.requestId);
          if (request.operation === 'updates.status') data = this.updates.status();
          else if (request.operation === 'updates.check') data = await this.updates.check();
          else data = await this.updates.request(request.operation === 'updates.download' ? 'download' : 'install', actor.clientId, params.data as Parameters<UpdateService['request']>[2], request.idempotencyKey, () => this.access.assertCurrent(actor, 'app.manage'));
        }
        else if (request.operation === 'access.list') data = this.access.list(actor);
        else if (request.operation === 'access.grant') data = await this.access.grant(actor, params.data as Parameters<AccessService['grant']>[1], request.idempotencyKey);
        else if (request.operation === 'access.revoke') data = await this.access.revoke(actor, params.data as Parameters<AccessService['revoke']>[1], request.idempotencyKey);
        else return failure('CAPABILITY_UNSUPPORTED', '该能力尚未实现', request.requestId);
        if (definition.readOnly) this.access.assertCurrent(actor, definition.scope);
      }
      return { ok: true, data, meta: { apiVersion, requestId: request.requestId, source: 'local', ...this.identity, workerPid: this.runtime.health().workerPid as number | null } };
    } catch (error) { return failure(error instanceof AccessError || error instanceof UpdateError || error instanceof ConfigurationError ? error.code : 'INTERNAL_ERROR', error instanceof AccessError || error instanceof UpdateError || error instanceof ConfigurationError ? error.message : '请求处理失败', request.requestId); }
  }
}
