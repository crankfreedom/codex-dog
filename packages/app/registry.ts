import { apiVersion, emptyParams, failure, requestSchema, responseSchema } from '../contracts/protocol.ts';
import type { Response } from '../contracts/protocol.ts';
import { QuotaService } from '../modules/quota/service.ts';
import type { UsageReadPort } from '../modules/quota/service.ts';

export interface RuntimeIdentity { runtimeId: string; handlerInstanceId: string; workerPid: number }
export class ApplicationRegistry {
  private identity: RuntimeIdentity;
  private quota: QuotaService;
  private ready = false;
  private handlers: Map<string, (params: Record<string, unknown>) => Record<string, unknown>>;
  constructor(port: UsageReadPort, identity: RuntimeIdentity) {
    this.identity = identity;
    this.quota = new QuotaService(port);
    this.handlers = new Map<string, (params: Record<string, unknown>) => Record<string, unknown>>([
      ['quota.get', () => this.quota.get()],
    ]);
  }
  async start() { await this.quota.start(); this.ready = true; }
  invoke(raw: unknown, scopes: readonly string[]): Response {
    if (raw && typeof raw === 'object' && 'apiVersion' in raw && raw.apiVersion !== apiVersion) return failure('PROTOCOL_INCOMPATIBLE', 'API major 不兼容');
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) return failure('INVALID_ARGUMENT', '请求结构无效或 API 版本不兼容');
    const request = parsed.data;
    if (!scopes.includes('read')) return failure('PERMISSION_DENIED', '当前调用方无读取权限', request.requestId);
    if (!this.ready) return failure('APP_NOT_READY', '业务进程未就绪', request.requestId);
    const handler = this.handlers.get(request.operation);
    if (!handler) return failure('CAPABILITY_UNSUPPORTED', '该能力尚未实现', request.requestId);
    const params = emptyParams.safeParse(request.params);
    if (!params.success) return failure('INVALID_ARGUMENT', '参数不符合能力契约', request.requestId);
    try {
      return responseSchema.parse({ ok: true, data: handler(params.data), meta: { apiVersion, requestId: request.requestId, source: 'fixture', ...this.identity } });
    } catch { return failure('INTERNAL_ERROR', '业务处理失败', request.requestId); }
  }
  close() { this.ready = false; this.quota.close(); }
}
