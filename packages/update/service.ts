import { gt, valid } from 'semver';
import { UpdateError } from './ports.ts';
import type { UpdateBackendPort, UpdateCandidate, UpdateLifecyclePort, UpdateOperation, UpdateState, UpdateStorePort } from './ports.ts';

export class UpdateService {
  private state: UpdateState;
  private options: { backend: UpdateBackendPort; store: UpdateStorePort; lifecycle: UpdateLifecyclePort; version: string; newId(): string; digest(value: string): string; now(): number };
  private tail: Promise<unknown> = Promise.resolve();
  private active?: Promise<void>;
  private closing = false;
  constructor(options: UpdateService['options']) {
    this.options = options;
    this.state = { schemaVersion: 1, phase: 'idle', candidate: null, artifact: null, operations: [], error: null };
  }
  async start() {
    this.state = await this.options.store.load();
    let changed = false;
    for (const operation of this.state.operations) {
      if (operation.state === 'awaiting_restart') {
        operation.state = operation.version === this.options.version ? 'succeeded' : 'failed';
        operation.error = operation.state === 'succeeded' ? null : 'INSTALL_NOT_APPLIED'; changed = true;
      } else if (['accepted', 'running'].includes(operation.state)) { operation.state = 'failed'; operation.error = 'OPERATION_INTERRUPTED'; changed = true; }
    }
    if (changed) { this.state.phase = this.state.operations.at(-1)?.state === 'succeeded' ? 'idle' : 'failed'; this.state.error = this.state.operations.at(-1)?.error ?? null; this.state.artifact = null; await this.options.store.save(this.state); }
  }
  status() {
    return { supported: this.options.backend.supported(), platform: 'win32', channel: 'beta', repository: 'crankfreedom/codex-dog', currentVersion: this.options.version, phase: this.state.phase, candidate: structuredClone(this.state.candidate), artifact: this.state.artifact ? { id: this.state.artifact.id, version: this.state.artifact.version } : null, operations: this.state.operations.slice(-20).map(o => ({ id: o.id, kind: o.kind, state: o.state, version: o.version, at: o.at, error: o.error })), error: this.state.error, unsignedTestDistribution: true, backend: this.options.backend.diagnostics?.() ?? null };
  }
  private ready() { if (this.closing) throw new UpdateError('APP_STOPPING', '更新模块正在退出'); if (!this.options.backend.supported()) throw new UpdateError('UPDATE_UNSUPPORTED', '仅独立 Windows G05 安装测试包支持更新'); }
  private mutate<T>(work: (state: UpdateState) => T): Promise<T> {
    const run = async () => { const next = structuredClone(this.state); const result = work(next); await this.options.store.save(next); this.state = next; return result; };
    const result = this.tail.then(run); this.tail = result.catch(() => {}); return result;
  }
  async check() {
    this.ready(); if (this.active) throw new UpdateError('UPDATE_BUSY', '更新操作尚未结束');
    try {
      const found = await this.options.backend.check();
      if (found && (!valid(found.version) || !gt(found.version, this.options.version) || !/^\d+\.\d+\.\d+-beta\.\d+$/.test(found.version))) throw new UpdateError('UPDATE_VERSION_REJECTED', '拒绝非 beta、同版或降级候选');
      await this.mutate(next => {
        const same = found && next.candidate?.version === found.version && next.candidate?.sha512 === found.sha512;
        next.candidate = found ? { ...found, id: same ? next.candidate!.id : this.options.newId() } : null;
        if (!same) next.artifact = null; next.phase = next.artifact ? 'ready' : found ? 'available' : 'idle'; next.error = null;
      });
      return this.status();
    } catch (error) { await this.mutate(next => { next.error = error instanceof UpdateError ? error.code : 'UPDATE_SOURCE_UNAVAILABLE'; }); throw error instanceof UpdateError ? error : new UpdateError('UPDATE_SOURCE_UNAVAILABLE', '更新源不可用'); }
  }
  async request(kind: 'download' | 'install', owner: string, params: { candidateId?: string; artifactId?: string; expectedVersion: string; confirm?: boolean }, key: string | undefined, guard: () => void) {
    this.ready(); if (!key) throw new UpdateError('INVALID_ARGUMENT', '更新变更须携带幂等键');
    guard(); const digest = this.options.digest(JSON.stringify([kind, params]));
    const operation = await this.mutate(next => {
      guard(); const old = next.operations.find(o => o.owner === owner && o.kind === kind && o.key === key);
      if (old) { if (old.digest !== digest) throw new UpdateError('IDEMPOTENCY_CONFLICT', '同键参数不一致'); return structuredClone(old); }
      if (this.active || ['downloading', 'installing', 'awaiting_restart'].includes(next.phase)) throw new UpdateError('UPDATE_BUSY', '更新操作尚未结束');
      if (next.operations.length >= 200) throw new UpdateError('UPDATE_HISTORY_FULL', '更新操作记录达到上限');
      if (kind === 'download' && (!next.candidate || next.candidate.id !== params.candidateId || next.candidate.version !== params.expectedVersion)) throw new UpdateError('UPDATE_VERSION_REJECTED', '下载目标已变化');
      if (kind === 'install' && (!params.confirm || !next.artifact || next.artifact.id !== params.artifactId || next.artifact.version !== params.expectedVersion)) throw new UpdateError('UPDATE_VERSION_REJECTED', '安装目标未明确确认或已变化');
      const value: UpdateOperation = { id: this.options.newId(), owner, key: key!, digest, kind, state: 'accepted', version: params.expectedVersion, at: this.options.now(), error: null };
      next.operations.push(value); next.phase = kind === 'download' ? 'downloading' : 'installing'; next.error = null; return value;
    });
    // 让调用方先收到 accepted 并退出短命 CLI，长期 MCP 的文件占用随后明确阻断。
    if (operation.state === 'accepted' && !this.active) this.active = this.run(operation, guard).finally(() => { this.active = undefined; });
    return { operationId: operation.id, state: operation.state, kind, expectedVersion: operation.version };
  }
  private async run(operation: UpdateOperation, guard: () => void) {
    try {
      await new Promise(resolve => setTimeout(resolve, 250)); this.ready(); guard();
      await this.mutate(next => { next.operations.find(o => o.id === operation.id)!.state = 'running'; });
      if (operation.kind === 'download') {
        const candidate = this.state.candidate!;
        const downloaded = await this.options.backend.download(candidate); guard();
        if (downloaded.version !== operation.version || downloaded.sha512 !== candidate.sha512) throw new UpdateError('UPDATE_VERSION_REJECTED', '下载结果与固定候选不符');
        await this.mutate(next => { next.artifact = { ...downloaded, id: this.options.newId() }; next.phase = 'ready'; next.operations.find(o => o.id === operation.id)!.state = 'succeeded'; });
      } else {
        const artifact = this.state.artifact!;
        await this.options.backend.verify(artifact); await this.options.lifecycle.prepare(operation.id); guard(); await this.options.backend.verify(artifact);
        await this.mutate(next => { next.phase = 'awaiting_restart'; next.operations.find(o => o.id === operation.id)!.state = 'awaiting_restart'; });
        guard(); await this.options.lifecycle.install(artifact, guard);
      }
    } catch (error) {
      const code = error instanceof UpdateError ? error.code : error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'UPDATE_FAILED';
      await this.mutate(next => { const value = next.operations.find(o => o.id === operation.id)!; value.state = 'failed'; value.error = code; next.error = code; next.phase = 'failed'; }).catch(() => {});
    }
  }
  async close() { this.closing = true; this.options.backend.cancel(); await this.active; await this.tail; }
}
