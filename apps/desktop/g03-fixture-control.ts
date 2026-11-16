import { join } from 'node:path';
import { z } from 'zod';
import { SqliteStore } from '../../packages/infrastructure/sqlite-store.ts';
import { TargetLeaseAdapter } from '../../packages/infrastructure/target-lease.ts';

const paramsSchema = z.object({ action: z.enum(['health', 'create', 'prepare', 'replay', 'uncertain', 'cancel', 'snapshot', 'backup']), id: z.string().min(1).max(100).optional(), key: z.string().min(1).max(100).optional(), revision: z.number().int().positive().optional(), target: z.string().regex(/^g03-fixture-/).max(160).optional(), fault: z.enum(['throw', 'crash', 'crash_after_commit']).optional() }).strict();
// 仅由显式测试开关启用；不注册到公开能力目录，不执行任何外部派发。
export class G03FixtureControl {
  private store: SqliteStore;
  private locks: TargetLeaseAdapter;
  private backupPath: string;
  fault?: 'throw' | 'crash' | 'crash_after_commit';
  constructor(store: SqliteStore, directory: string) {
    this.store = store; this.locks = new TargetLeaseAdapter({ directory: join(directory, 'fixture-target-locks'), verified: true });
    this.backupPath = join(directory, 'fixture-backup.sqlite');
  }
  start() { this.locks.start(); }
  onStep(stage: string) {
    if (stage !== 'intent:count' || !this.fault || this.fault === 'crash_after_commit') return;
    const fault = this.fault; this.fault = undefined;
    if (fault === 'crash') process.exit(31);
    throw new Error('G03 注入事务失败');
  }
  execute(raw: unknown): Record<string, unknown> {
    const p = paramsSchema.parse(raw);
    if (p.action === 'health') return { ...this.store.health(), node: process.versions.node, electron: process.versions.electron };
    if (p.action === 'snapshot') return this.store.snapshot();
    if (p.action === 'backup') { this.store.backup(this.backupPath); return { backedUp: true }; }
    if (!p.id) throw new Error('缺少模拟资源 ID');
    if (p.action === 'create') { if (!p.target) throw new Error('缺少模拟目标'); this.store.createFixtureTask({ id: p.id, target: p.target, revision: 1, count: 0, maxCount: 3 }); }
    if (p.action === 'uncertain') this.store.markFixtureUncertain(p.id);
    if (p.action === 'cancel') this.store.cancelFixtureBeforeWrite(p.id);
    if (p.action === 'replay') {
      if (!p.key) throw new Error('缺少原幂等键');
      return this.store.prepareFixtureIntent({ taskId: p.id, expectedRevision: p.revision ?? 1, clientId: 'g03-fixture', attemptId: p.key, key: p.key }, () => { throw new Error('回放不能创建新意图'); });
    }
    if (p.action === 'prepare') {
      if (!p.target || !p.key) throw new Error('缺少模拟目标或幂等键');
      const lease = this.locks.acquire(p.target); this.fault = p.fault;
      try {
        const result = this.store.prepareFixtureIntent({ taskId: p.id, expectedRevision: p.revision ?? 1, clientId: 'g03-fixture', attemptId: p.key, key: p.key }, target => { if (target !== lease.target) throw new Error('租约目标不匹配'); this.locks.assertOwned(lease); });
        if (p.fault === 'crash_after_commit') process.exit(32);
        return result;
      }
      finally { this.fault = undefined; this.locks.release(lease); }
    }
    return { saved: true };
  }
  close() { this.locks.close(); }
}
