import type { Credential, Scope } from '../../contracts/protocol.ts';

export class AccessError extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }
export interface ClientRecord {
  id: string; label: string; secretHash: string; requestedScopes: Scope[]; scopes: Scope[];
  status: 'pending' | 'granted' | 'revoked'; revision: number; createdAt: number; pairingExpiresAt: number; expiresAt: number | null; code: string;
}
export interface AccessState { schemaVersion: 1; clients: ClientRecord[]; requests: Array<{ key: string; hash: string; result: Record<string, unknown>; at: number }> }
export interface AccessStorePort { load(): Promise<AccessState>; save(state: AccessState): Promise<void> }
export interface Principal { kind: 'desktop' | 'external'; clientId: string; revision: number; scopes: readonly Scope[] }
export interface AccessPorts { store: AccessStorePort; digest(value: string): string; equal(a: string, b: string): boolean; newCode(): string; now(): number }
export class AccessService {
  private ports: AccessPorts;
  private state: AccessState = { schemaVersion: 1, clients: [], requests: [] };
  private tail: Promise<unknown> = Promise.resolve();
  constructor(ports: AccessPorts) { this.ports = ports; }
  async start() { this.state = await this.ports.store.load(); }
  authenticate(credential?: Credential): Principal {
    if (!credential) throw new AccessError('AUTH_REQUIRED', '请先申请并完成桌面配对');
    const client = this.state.clients.find(item => item.id === credential.clientId);
    if (!client || !this.ports.equal(client.secretHash, this.ports.digest(credential.clientId + ':' + credential.secret))) throw new AccessError('PERMISSION_DENIED', '客户端凭据无效');
    if (client.status === 'revoked' || client.expiresAt !== null && client.expiresAt <= this.ports.now()) throw new AccessError('AUTH_REVOKED', '客户端授权已撤销或到期');
    if (client.status !== 'granted') throw new AccessError('AUTH_REQUIRED', '申请尚未批准，请在主应用核对配对码');
    return { kind: 'external', clientId: client.id, revision: client.revision, scopes: [...client.scopes] };
  }
  assertCurrent(actor: Principal, scope?: string) {
    if (actor.kind !== 'desktop') {
      const current = this.state.clients.find(item => item.id === actor.clientId);
      if (!current || current.status !== 'granted' || current.revision !== actor.revision || current.expiresAt !== null && current.expiresAt <= this.ports.now()) throw new AccessError('AUTH_REVOKED', '授权已变更，停止返回该请求结果');
    }
    if (scope && !actor.scopes.includes(scope as Scope)) throw new AccessError('PERMISSION_DENIED', '当前客户端无此权限');
  }
  private view(client: ClientRecord) {
    return { id: client.id, label: client.label, status: client.status, revision: client.revision, requestedScopes: [...client.requestedScopes], scopes: [...client.scopes], createdAt: client.createdAt,
      expiresAt: client.expiresAt, pairingExpiresAt: client.pairingExpiresAt, code: client.status === 'pending' ? client.code : null };
  }
  list(actor: Principal) { this.assertCurrent(actor, 'access.manage'); return { clients: this.state.clients.map(client => this.view(client)) }; }
  private mutate(actorId: string, operation: string, key: string | undefined, body: unknown, action: (next: AccessState) => Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!key) return Promise.reject(new AccessError('INVALID_ARGUMENT', '授权变更必须携带幂等键'));
    const run = async () => {
      const combined = actorId + ':' + operation + ':' + key;
      const hash = this.ports.digest(JSON.stringify(body));
      const existing = this.state.requests.find(item => item.key === combined);
      if (existing) { if (existing.hash !== hash) throw new AccessError('IDEMPOTENCY_CONFLICT', '同一幂等键不能用于不同参数'); return structuredClone(existing.result); }
      const next = structuredClone(this.state);
      next.requests = next.requests.filter(item => this.ports.now() - item.at < 30 * 86400000);
      if (next.requests.length >= 2048) throw new AccessError('CLIENT_LIMIT', '授权操作记录达到上限');
      const result = action(next);
      next.requests.push({ key: combined, hash, result, at: this.ports.now() });
      try { await this.ports.store.save(next); } catch { throw new AccessError('STORAGE_FAILURE', '授权保存失败，未更新授权状态'); }
      this.state = next;
      return structuredClone(result);
    };
    const result = this.tail.then(run); this.tail = result.catch(() => {}); return result;
  }
  request(credential: Credential, input: { clientLabel: string; requestedScopes: Scope[] }, key?: string) {
    const secretHash = this.ports.digest(credential.clientId + ':' + credential.secret);
    const existing = this.state.clients.find(item => item.id === credential.clientId);
    if (existing && (!this.ports.equal(existing.secretHash, secretHash) || existing.status === 'revoked')) throw new AccessError(existing.status === 'revoked' ? 'AUTH_REVOKED' : 'PERMISSION_DENIED', '该客户端身份不可重新申请，请使用新客户端名称');
    return this.mutate(credential.clientId, 'access.request', key, { ...input, secretHash }, next => {
      const old = next.clients.find(item => item.id === credential.clientId);
      if (old) {
        if (!this.ports.equal(old.secretHash, secretHash)) throw new AccessError('PERMISSION_DENIED', '客户端身份已存在');
        if (old.status === 'revoked') throw new AccessError('AUTH_REVOKED', '请使用新客户端名称重新申请');
        return this.view(old);
      }
      if (new Set(input.requestedScopes).size !== input.requestedScopes.length || input.requestedScopes.some(scope => !['read', 'access.manage', 'app.manage'].includes(scope))) throw new AccessError('INVALID_ARGUMENT', '权限申请无效');
      if (next.clients.length >= 1000 || next.clients.filter(item => item.status === 'pending' && item.pairingExpiresAt > this.ports.now()).length >= 32) throw new AccessError('CLIENT_LIMIT', '待配对客户端达到上限');
      const client: ClientRecord = { id: credential.clientId, label: input.clientLabel, secretHash, requestedScopes: [...input.requestedScopes], scopes: [], status: 'pending', revision: 1, createdAt: this.ports.now(), pairingExpiresAt: this.ports.now() + 300000, expiresAt: null, code: this.ports.newCode() };
      next.clients.push(client); return this.view(client);
    });
  }
  grant(actor: Principal, input: { id: string; expectedRevision: number; code: string; scopes: Scope[]; expiresAt: string | null }, key?: string) {
    this.assertCurrent(actor, 'access.manage');
    return this.mutate(actor.clientId, 'access.grant', key, input, next => {
      this.assertCurrent(actor, 'access.manage');
      const client = next.clients.find(item => item.id === input.id);
      if (!client || client.status !== 'pending' || client.revision !== input.expectedRevision) throw new AccessError('REVISION_CONFLICT', '申请状态或修订已变化');
      if (client.pairingExpiresAt <= this.ports.now()) throw new AccessError('PAIRING_EXPIRED', '配对已过期，请创建新申请');
      if (!this.ports.equal(client.code, input.code) || new Set(input.scopes).size !== input.scopes.length || input.scopes.some(scope => !client.requestedScopes.includes(scope) || !actor.scopes.includes(scope))) throw new AccessError('PERMISSION_DENIED', '配对码或可委派权限不匹配');
      const expiry = input.expiresAt === null ? null : Date.parse(input.expiresAt);
      if (expiry !== null && (!Number.isFinite(expiry) || expiry <= this.ports.now())) throw new AccessError('INVALID_ARGUMENT', '授权到期时间必须在未来');
      client.status = 'granted'; client.scopes = [...input.scopes]; client.expiresAt = expiry; client.revision += 1; client.code = '';
      return this.view(client);
    });
  }
  revoke(actor: Principal, input: { id: string; expectedRevision: number }, key?: string) {
    this.assertCurrent(actor, 'access.manage');
    return this.mutate(actor.clientId, 'access.revoke', key, input, next => {
      this.assertCurrent(actor, 'access.manage');
      const client = next.clients.find(item => item.id === input.id);
      if (!client || client.revision !== input.expectedRevision) throw new AccessError('REVISION_CONFLICT', '客户端修订已变化');
      client.status = 'revoked'; client.revision += 1; client.scopes = []; client.code = ''; return this.view(client);
    });
  }
  async close() { await this.tail; }
}
