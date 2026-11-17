import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, existsSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { TargetLeaseAdapter } from '../packages/infrastructure/target-lease.ts';

const directory = () => mkdtempSync(join(tmpdir(), 'codex-dog-g03-自定义 空格-'));
const lockPath = (dir: string, target: string) => join(dir, createHash('sha256').update(target).digest('hex') + '.lock');
const legacySource = resolve(process.env.DOG_LEGACY_SOURCE ?? '../codex-resume/src/store.ts');
const legacyOptions = { skip: existsSync(legacySource) ? false : '未提供旧源码；原始旧版互操作证据见 G03，本仓库 CI 不冒充该验证' };
async function contender(mode: string, dir: string, target: string) {
  const child = fork(resolve('test/helpers/lock-holder.mjs'), [mode, dir, target, legacySource], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  child.stderr?.resume();
  const timeout = setTimeout(() => child.kill(), 15000); child.once('exit', () => clearTimeout(timeout));
  await once(child, 'message');
  return { child, acquire: async () => { const waiting = once(child, 'message'); child.send('acquire'); return (await waiting)[0] as { acquired: boolean }; }, release: async () => { if (child.exitCode !== null) return; const done = once(child, 'exit'); if (child.connected) child.send('release', error => { if (error && child.exitCode === null) child.kill(); }); await done; } };
}
test('目标租约构造不建目录；未明确核对位置、相对路径均拒绝', () => {
  assert.throws(() => new TargetLeaseAdapter().start(), /核对/); assert.throws(() => new TargetLeaseAdapter({ directory: 'relative', verified: true }).start(), /核对/);
  assert.throws(() => new TargetLeaseAdapter({ directory: '//server/share', verified: true }).start(), /核对/);
  const dir = join(directory(), 'not-created'); const locks = new TargetLeaseAdapter({ directory: dir, verified: true }); assert(!existsSync(dir)); locks.start(); locks.close();
});
test('独占创建使用旧版 SHA256/PID/token 格式，独立目标不相互阻断', () => {
  const dir = directory(); const locks = new TargetLeaseAdapter({ directory: dir, verified: true }); locks.start();
  try { const lease = locks.acquire('g03-fixture-a'); const record = JSON.parse(readFileSync(lockPath(dir, lease.target), 'utf8')); assert.equal(record.pid, process.pid); assert.equal(record.token, lease.token); assert.throws(() => locks.acquire(lease.target), /已有锁/); const other = locks.acquire('g03-fixture-b'); locks.release(other); locks.assertOwned(lease); locks.release(lease); assert.equal(readdirSync(dir).length, 0); }
  finally { locks.close(); }
});
for (const first of ['legacy', 'new']) test(`${first} 真实源码子进程持有时另一方拒绝，释放后可获取`, legacyOptions, async () => {
  const dir = directory(); const target = 'g03-fixture-dual'; const owner = await contender(first, dir, target); const secondMode = first === 'legacy' ? 'new' : 'legacy';
  try { assert((await owner.acquire()).acquired); const blocked = await contender(secondMode, dir, target); assert.equal((await blocked.acquire()).acquired, false); await owner.release(); const next = await contender(secondMode, dir, target); try { assert((await next.acquire()).acquired); } finally { await next.release(); } }
  finally { await owner.release(); }
});
test('旧版与新版同时竞争同一模拟目标恰好一个获胜', legacyOptions, async () => {
  for (let i = 0; i < 4; i++) {
    const dir = directory(); const contenders = await Promise.all(['legacy', 'new'].map(mode => contender(mode, dir, 'g03-fixture-race')));
    try { const results = await Promise.all(contenders.map(c => c.acquire())); assert.equal(results.filter(r => r.acquired).length, 1); }
    finally { await Promise.all(contenders.map(c => c.release())); }
  }
});
test('旧版异常退出遗留锁不自动抢占，即使 PID 已退出也保守阻断', legacyOptions, async () => {
  const dir = directory(); const owner = await contender('legacy', dir, 'g03-fixture-stale'); assert((await owner.acquire()).acquired);
  const ended = once(owner.child, 'exit'); owner.child.send('crash'); await ended;
  const locks = new TargetLeaseAdapter({ directory: dir, verified: true }); locks.start();
  try { assert.throws(() => locks.acquire('g03-fixture-stale'), /已有锁/); assert(existsSync(lockPath(dir, 'g03-fixture-stale'))); } finally { locks.close(); }
});
test('未知/损坏锁保留，替换 token 后旧持有者不能删除别人的文件', () => {
  const dir = directory(); const locks = new TargetLeaseAdapter({ directory: dir, verified: true }); locks.start();
  writeFileSync(lockPath(dir, 'g03-fixture-corrupt'), '{bad'); assert.throws(() => locks.acquire('g03-fixture-corrupt'), /已有锁/);
  const lease = locks.acquire('g03-fixture-replaced'); const replacement = JSON.stringify({ pid: process.pid, token: 'replacement' }); writeFileSync(lockPath(dir, lease.target), replacement);
  assert.throws(() => locks.assertOwned(lease), /不能确认/); assert.throws(() => locks.release(lease), /不能确认/); assert.throws(() => locks.close(), /未释放/); assert.equal(readFileSync(lockPath(dir, lease.target), 'utf8'), replacement);
});

test('独立仓库也验证两个真实新版子进程竞争恰好一个获胜', async () => {
  const dir = directory(); const contenders = await Promise.all(['new', 'new'].map(mode => contender(mode, dir, 'g06-fixture-race')));
  try { const results = await Promise.all(contenders.map(c => c.acquire())); assert.equal(results.filter(r => r.acquired).length, 1); }
  finally { await Promise.all(contenders.map(c => c.release())); }
});
