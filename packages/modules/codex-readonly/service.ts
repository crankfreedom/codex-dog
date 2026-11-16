import { ReadError } from './ports.ts';
import type { CodexReadPort, GoalReadPort, GoalState, ReadonlyOptions } from './ports.ts';

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReadError('PROVIDER_SCHEMA_UNSUPPORTED', '只读数据结构不兼容');
  return value as Record<string, unknown>;
};
const knownStates = new Set(['active', 'idle', 'notLoaded', 'systemError']);
export class CodexReadonlyService {
  private provider: CodexReadPort;
  private goals: GoalReadPort;
  private options: ReadonlyOptions;
  private connectionId: string;
  private fingerprint?: string;
  private revision = 1;
  private poisoned = false;
  private lastError: string | null = null;
  private snapshot?: Record<string, unknown>;
  private refreshTask?: Promise<Record<string, unknown>>;
  constructor(provider: CodexReadPort, goals: GoalReadPort, options: ReadonlyOptions) {
    this.provider = provider; this.goals = goals; this.options = options; this.connectionId = options.newId();
  }
  async start() { try { await this.refresh(); } catch (error) { this.lastError = error instanceof ReadError ? error.code : 'PROVIDER_UNAVAILABLE'; } }
  status() { return { connectionId: this.connectionId, revision: this.revision, source: 'live', state: this.poisoned ? 'identity_changed' : this.provider.connected() && this.fingerprint && !this.lastError ? 'ready' : 'unavailable', identityVerified: !!this.fingerprint && !this.poisoned && !this.lastError, goalAccountBindingVerified: false, reason: this.lastError, readOnly: true, readCalls: this.provider.audit?.() ?? {} }; }
  discover() { return this.provider.discover(); }
  private selection(connectionId: unknown) {
    if (connectionId !== this.connectionId) throw new ReadError('CONNECTION_IDENTITY_CHANGED', '连接实例已变化，请重新读取连接信息');
    if (this.poisoned) throw new ReadError('CONNECTION_IDENTITY_CHANGED', '账号身份已变化，须明确重新选择连接');
  }
  private bind(raw: unknown) {
    if (this.poisoned) throw new ReadError('CONNECTION_IDENTITY_CHANGED', '账号身份已变化，须重新选择');
    const quota = object(raw);
    if (typeof quota.accountId !== 'string' || !quota.accountId) { this.snapshot = undefined; this.lastError = 'PROVIDER_IDENTITY_UNAVAILABLE'; throw new ReadError('PROVIDER_IDENTITY_UNAVAILABLE', '无法确认当前桌面账号身份'); }
    const digest = this.options.digest(quota.accountId);
    if (this.fingerprint && digest !== this.fingerprint) {
      this.poisoned = true; this.revision++; this.snapshot = undefined; this.lastError = 'CONNECTION_IDENTITY_CHANGED';
      throw new ReadError('CONNECTION_IDENTITY_CHANGED', '桌面账号身份已变化，停止返回原连接数据');
    }
    this.fingerprint = digest; this.lastError = null; return quota;
  }
  private normalize(raw: unknown) {
    const quota = this.bind(raw);
    const buckets = quota.rateLimitsByLimitId;
    const bucket = buckets != null ? object(buckets).codex : quota.rateLimits;
    const value = bucket == null ? {} : object(bucket);
    const windows = ['primary', 'secondary'].map((key, index) => {
      const raw = value[key] == null ? {} : object(value[key]); const percent = raw.usedPercent;
      if (percent != null && (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100)) throw new ReadError('PROVIDER_SCHEMA_UNSUPPORTED', '额度百分比无效');
      if (raw.resetsAt != null && (typeof raw.resetsAt !== 'number' || !Number.isFinite(raw.resetsAt) || raw.resetsAt < 0)) throw new ReadError('PROVIDER_SCHEMA_UNSUPPORTED', '额度重置时间无效');
      return { name: index ? 'secondary' : 'primary', usedPercent: percent ?? null, remainingPercent: typeof percent === 'number' ? 100 - percent : null, resetsAt: raw.resetsAt ?? null, windowDurationMins: typeof raw.windowDurationMins === 'number' ? raw.windowDurationMins : null };
    });
    const blocked = value.spendControlReached === true || !!value.rateLimitReachedType || quota.ordinaryUsageAllowed === false || windows.some(w => w.usedPercent !== null && Number(w.usedPercent) >= 100);
    const unknown = windows.some(w => w.usedPercent === null);
    return { source: 'live', observedAt: new Date(this.options.now()).toISOString(), stale: false, connectionId: this.connectionId, connectionRevision: this.revision, available: blocked ? false : unknown ? null : true, reason: blocked ? 'quota_exhausted' : unknown ? 'quota_unknown' : 'quota_available', windows };
  }
  async refresh(): Promise<Record<string, unknown>> {
    if (this.refreshTask) return this.refreshTask;
    this.refreshTask = (async () => {
      try { await this.provider.start(); this.snapshot = this.normalize(await this.provider.read('get_usage_limits', {})); this.lastError = null; return this.getQuota(); }
      catch (error) { this.snapshot = undefined; this.lastError = error instanceof ReadError ? error.code : 'PROVIDER_UNAVAILABLE'; throw error; }
      finally { this.refreshTask = undefined; }
    })();
    return this.refreshTask;
  }
  getQuota(): Record<string, unknown> {
    if (this.poisoned) throw new ReadError('CONNECTION_IDENTITY_CHANGED', '账号身份已变化');
    if (!this.snapshot || !this.provider.connected()) throw new ReadError(this.lastError ?? 'PROVIDER_UNAVAILABLE', '真实额度观察不可用，请检查只读连接');
    const stale = this.options.now() - Date.parse(String(this.snapshot.observedAt)) > 30000;
    return structuredClone({ ...this.snapshot, ...(stale ? { stale: true, available: null, reason: 'observation_expired' } : {}) });
  }
  private async guarded<T>(connectionId: unknown, read: () => Promise<T>): Promise<T> {
    this.selection(connectionId); this.bind(await this.provider.read('get_usage_limits', {}));
    const result = await read(); this.bind(await this.provider.read('get_usage_limits', {})); this.selection(connectionId); return result;
  }
  async list(params: Record<string, unknown>) {
    return this.guarded(params.connectionId, async () => {
      const raw = object(await this.provider.read('list_threads', { mode: 'history', source: 'codex', hostId: 'local', limit: params.limit, archived: params.archived, ...(params.cursor ? { cursor: params.cursor } : {}) }));
      if (!Array.isArray(raw.threads) || raw.threads.length > Number(params.limit) || raw.nextCursor != null && (typeof raw.nextCursor !== 'string' || raw.nextCursor.length > 2000)) throw new ReadError('PROVIDER_SCHEMA_UNSUPPORTED', '会话分页结构不兼容');
      const items = raw.threads.map(value => {
        const row = object(value);
        if (typeof row.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(row.id) || row.kind !== 'codex' || row.hostId !== 'local' || typeof row.status !== 'string' || row.status.length > 100) throw new ReadError('TARGET_IDENTITY_MISMATCH', '会话来源或身份不匹配');
        return { threadId: row.id, connectionId: this.connectionId, status: row.status, statusKnown: knownStates.has(row.status) };
      });
      return { items, nextCursor: raw.nextCursor ?? null, source: 'live', observedAt: new Date(this.options.now()).toISOString(), stale: false, connectionRevision: this.revision };
    });
  }
  private async inspect(params: Record<string, unknown>) {
    const threadId = String(params.threadId);
    return this.guarded(params.connectionId, async () => {
      const before = this.goals.read(threadId);
      const raw = object(await this.provider.read('read_thread', { threadId, hostId: 'local', turnLimit: 1, includeOutputs: false, maxOutputCharsPerItem: 0 }));
      const thread = object(raw.thread); const status = object(thread.status);
      if (thread.id !== threadId || thread.kind !== 'codex' || thread.hostId !== 'local') throw new ReadError('TARGET_IDENTITY_MISMATCH', '返回会话身份不匹配');
      if (typeof status.type !== 'string' || status.type.length > 100 || !Array.isArray(raw.turns) || raw.turns.length > 1 || status.activeFlags != null && (!Array.isArray(status.activeFlags) || status.activeFlags.length > 20 || status.activeFlags.some(x => typeof x !== 'string' || x.length > 100))) throw new ReadError('PROVIDER_SCHEMA_UNSUPPORTED', '会话状态结构不兼容');
      const after = this.goals.read(threadId);
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new ReadError('GOAL_IDENTITY_CHANGED', '读取期间 Goal 身份或状态已变化');
      let latestTurn: { id: string; status: string } | null = null;
      if (raw.turns.length) { const turn = object(raw.turns[0]); if (typeof turn.id !== 'string' || typeof turn.status !== 'string') throw new ReadError('PROVIDER_SCHEMA_UNSUPPORTED', '最新轮次状态无效'); latestTurn = { id: turn.id, status: turn.status }; }
      return { connectionId: this.connectionId, threadId, status: status.type, statusKnown: knownStates.has(status.type), activeFlags: status.activeFlags ?? [], latestTurn, goal: after, source: 'live', observedAt: new Date(this.options.now()).toISOString(), stale: false, connectionRevision: this.revision, completionConfirmed: false, goalAccountBindingVerified: false };
    });
  }
  async thread(params: Record<string, unknown>) { return this.inspect(params); }
  async goal(params: Record<string, unknown>) {
    const view = await this.inspect(params);
    return { connectionId: view.connectionId, threadId: view.threadId, ...view.goal, source: 'local', observedAt: view.observedAt, stale: false, connectionRevision: this.revision, desktopThreadVerified: true, goalAccountBindingVerified: false, completionConfirmed: false };
  }
  close() { this.snapshot = undefined; this.provider.close(); }
}
