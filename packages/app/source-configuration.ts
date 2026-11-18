import { sourceSelection, sourceConfigureParams } from '../contracts/protocol.ts';
import type { z } from 'zod';

export type SourceSelection = z.infer<typeof sourceSelection>;
export interface SourceState { schemaVersion: 1; revision: number; selection: SourceSelection; requests: Array<{ key: string; body: string; result: Record<string, unknown> }> }
export interface SourceStore { load(): Promise<SourceState>; save(value: SourceState): Promise<void> }
export class ConfigurationError extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }
export const defaultSourceState = (): SourceState => ({ schemaVersion: 1, revision: 1, selection: { source: 'fixture', callerThreadId: '', pipe: '' }, requests: [] });
export class SourceConfiguration {
  private state = defaultSourceState();
  private active: SourceSelection = { ...this.state.selection };
  private overridden = false;
  private tail: Promise<unknown> = Promise.resolve();
  private store: SourceStore;
  constructor(store: SourceStore) { this.store = store; }
  async start(overrides: Partial<SourceSelection>, environmentCaller = '') {
    this.state = await this.store.load();
    this.overridden = Object.keys(overrides).length > 0;
    this.active = sourceSelection.parse({ ...this.state.selection, ...overrides });
    if (this.active.source === 'fixture') this.active = { source: 'fixture', callerThreadId: '', pipe: '' };
    else if (!this.active.callerThreadId && environmentCaller) { this.active = sourceSelection.parse({ ...this.active, callerThreadId: environmentCaller }); this.overridden = true; }
    return { ...this.active };
  }
  get(): Record<string, unknown> { return { active: { ...this.active }, saved: { ...this.state.selection }, revision: this.state.revision, override: this.overridden, restartRequired: JSON.stringify(this.active) !== JSON.stringify(this.state.selection) }; }
  configure(raw: unknown, actor: string, key: string | undefined, guard: () => void): Promise<Record<string, unknown>> {
    const input = sourceConfigureParams.parse(raw);
    if (!key) return Promise.reject(new ConfigurationError('INVALID_ARGUMENT', '保存来源必须携带幂等键'));
    const run = async () => {
      guard();
      const combined = actor + ':' + key; const body = JSON.stringify(input);
      const previous = this.state.requests.find(item => item.key === combined);
      if (previous) { if (previous.body !== body) throw new ConfigurationError('IDEMPOTENCY_CONFLICT', '同键不能保存不同来源'); return structuredClone(previous.result); }
      if (input.expectedRevision !== this.state.revision) throw new ConfigurationError('REVISION_CONFLICT', '来源配置已变化，请重新读取');
      if (this.state.requests.length >= 2048) throw new ConfigurationError('CLIENT_LIMIT', '来源配置操作记录达到上限');
      const next = structuredClone(this.state); next.revision++;
      next.selection = sourceSelection.parse(input.source === 'fixture' ? { source: 'fixture', callerThreadId: '', pipe: '' } : { source: input.source, callerThreadId: input.callerThreadId, pipe: input.pipe,...(input.codexHome?{codexHome:input.codexHome}:{}),...(input.legacyLockDirectory?{legacyLockDirectory:input.legacyLockDirectory}:{}),...(input.cardExecutable?{cardExecutable:input.cardExecutable,allowCardConsumption:input.allowCardConsumption===true}:{}) });
      const result = { saved: next.selection, revision: next.revision, restartRequired: JSON.stringify(this.active) !== JSON.stringify(next.selection) };
      next.requests.push({ key: combined, body, result }); guard();
      try { await this.store.save(next); } catch { throw new ConfigurationError('STORAGE_FAILURE', '来源保存失败，当前配置未更改'); }
      this.state = next; return structuredClone(result);
    };
    const task = this.tail.then(run); this.tail = task.catch(() => {}); return task;
  }
  async close() { await this.tail; }
}
