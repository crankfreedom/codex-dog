import { apiVersion, definitions, describe, failure, requestSchema, version, workerOperations, liveOperations } from '../contracts/protocol.ts';
import type { Credential, Request, Response } from '../contracts/protocol.ts';
import { AccessError, AccessService } from '../modules/access/service.ts';
import type { Principal } from '../modules/access/service.ts';

export interface HostRuntime { invoke(request: Request): Promise<Response>; health(): Record<string, unknown> }
export class HostRouter {
  private access: AccessService;
  private runtime: HostRuntime;
  private identity: { runtimeId: string; handlerInstanceId: string };
  private stopping = false;
  private mode: 'fixture' | 'live-readonly';
  constructor(access: AccessService, runtime: HostRuntime, identity: HostRouter['identity'], mode: 'fixture' | 'live-readonly' = 'fixture') { this.access = access; this.runtime = runtime; this.identity = identity; this.mode = mode; }
  stop() { this.stopping = true; }
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
        data = await this.access.request(context.credential, params.data as { clientLabel: string; requestedScopes: Array<'read' | 'access.manage'> }, request.idempotencyKey);
      } else {
        const actor: Principal = 'trustedDesktop' in context ? { kind: 'desktop', clientId: 'desktop', revision: 1, scopes: ['read', 'access.manage'] } : this.access.authenticate(context.credential);
        this.access.assertCurrent(actor, definition.scope);
        if (workerOperations.has(request.operation)) {
          if (this.mode === 'fixture' && liveOperations.has(request.operation)) return failure('PROVIDER_UNAVAILABLE', '该读取要求显式启动 live-readonly 模式', request.requestId);
          const result = await this.runtime.invoke(request); this.access.assertCurrent(actor, 'read'); return result;
        }
        if (request.operation === 'app.status') data = { state: this.runtime.health().state, mode: this.mode, realCodexConnected: this.mode === 'live-readonly' && (this.runtime.health().provider as { state?: string } | undefined)?.state === 'ready', ...this.runtime.health() };
        else if (request.operation === 'app.version') data = { version, apiVersion };
        else if (request.operation === 'capabilities.list') data = { capabilities: definitions.map(d => ({ ...describe(d.operation), available: this.mode === 'live-readonly' || !liveOperations.has(d.operation), allowed: actor.scopes.includes(d.scope as 'read' | 'access.manage') })) };
        else if (request.operation === 'capabilities.describe') { const name = String((params.data as { operation: string }).operation); data = describe(name) ? { ...describe(name), available: this.mode === 'live-readonly' || !liveOperations.has(name) } : { available: false }; }
        else if (request.operation === 'access.list') data = this.access.list(actor);
        else if (request.operation === 'access.grant') data = await this.access.grant(actor, params.data as Parameters<AccessService['grant']>[1], request.idempotencyKey);
        else if (request.operation === 'access.revoke') data = await this.access.revoke(actor, params.data as Parameters<AccessService['revoke']>[1], request.idempotencyKey);
        else return failure('CAPABILITY_UNSUPPORTED', '该能力尚未实现', request.requestId);
        if (definition.readOnly) this.access.assertCurrent(actor, definition.scope);
      }
      return { ok: true, data, meta: { apiVersion, requestId: request.requestId, source: 'local', ...this.identity, workerPid: this.runtime.health().workerPid as number | null } };
    } catch (error) { return failure(error instanceof AccessError ? error.code : 'INTERNAL_ERROR', error instanceof AccessError ? error.message : '请求处理失败', request.requestId); }
  }
}
