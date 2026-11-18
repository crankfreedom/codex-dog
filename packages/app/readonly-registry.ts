import { definitions, failure, requestSchema, apiVersion } from '../contracts/protocol.ts';
import type { Response } from '../contracts/protocol.ts';
import type { RuntimeIdentity } from './registry.ts';
import { CodexReadonlyService } from '../modules/codex-readonly/service.ts';
import { ReadError } from '../modules/codex-readonly/ports.ts';

export class ReadonlyRegistry {
  private service: CodexReadonlyService;
  private identity: RuntimeIdentity;
  constructor(service: CodexReadonlyService, identity: RuntimeIdentity) { this.service = service; this.identity = identity; }
  async start() { await this.service.start(); }
  status() { return this.service.status(); }
  accountObservation(){return this.service.accountObservation();}
  quota(){return this.service.getQuota();}
  async invoke(raw: unknown, scopes: readonly string[]): Promise<Response> {
    const parsed = requestSchema.safeParse(raw); if (!parsed.success) return failure('INVALID_ARGUMENT', '请求契约不兼容');
    const request = parsed.data;
    if (!scopes.includes('read')) return failure('PERMISSION_DENIED', '缺少读取权限', request.requestId);
    const definition = definitions.find(d => d.operation === request.operation);
    if (!definition) return failure('CAPABILITY_UNSUPPORTED', '该能力尚未实现', request.requestId);
    const input = definition.input.safeParse(request.params); if (!input.success) return failure('INVALID_ARGUMENT', '只读参数无效', request.requestId);
    try {
      let data: Record<string, unknown>;
      if (request.operation === 'quota.get') data = this.service.getQuota();
      else if (request.operation === 'quota.refresh') data = await this.service.refresh();
      else if (request.operation === 'connections.get') data = this.service.status();
      else if (request.operation === 'connections.discover') data = this.service.discover();
      else if (request.operation === 'threads.list') data = await this.service.list(input.data);
      else if (request.operation === 'threads.get') data = await this.service.thread(input.data);
      else if (request.operation === 'goals.get') data = await this.service.goal(input.data);
      else return failure('CAPABILITY_UNSUPPORTED', '不是业务只读操作', request.requestId);
      return { ok: true, data, meta: { apiVersion, requestId: request.requestId, source: this.service.status().source === 'fixture' ? 'fixture' : request.operation === 'goals.get' ? 'local' : 'live', ...this.identity } };
    } catch (error) { return failure(error instanceof ReadError ? error.code : 'PROVIDER_UNAVAILABLE', error instanceof ReadError ? error.message : '只读来源不可用', request.requestId); }
  }
  close() { this.service.close(); }
}
