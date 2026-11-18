import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CodexReadonlyService } from '../packages/modules/codex-readonly/service.ts';
import type { CodexReadPort, GoalState, ReadTool } from '../packages/modules/codex-readonly/ports.ts';
import { CodexDesktopReadonly } from '../packages/infrastructure/codex-desktop-readonly.ts';
import { CodexGoalReadonly } from '../packages/infrastructure/codex-goal-readonly.ts';

const id = '11111111-1111-4111-8111-111111111111'; const target = '22222222-2222-4222-8222-222222222222';
const quota = () => ({ accountId: 'private-account', ordinaryUsageAllowed: true, rateLimits: { primary: { usedPercent: 1 }, secondary: { usedPercent: 1 } }, rateLimitsByLimitId: { codex: { primary: { usedPercent: 25, resetsAt: 1 }, secondary: { usedPercent: 40 } } } });
function setup() {
  let now = 100000; let connected = false; let rawQuota: unknown = quota(); let goal: GoalState = { availability: 'known', current: null, reason: null };
  let rawThread: unknown = { thread: { id: target, kind: 'codex', hostId: 'local', status: { type: 'active', activeFlags: [] }, title: 'private-title', preview: 'private-body' }, turns: [{ id: 'turn-1', status: 'inProgress', items: [{ text: 'private-body' }] }] };
  const calls: string[] = []; let callback: ((name: string) => void) | undefined;
  const provider: CodexReadPort = {
    async start() { connected = true; }, connected: () => connected, close() { connected = false; }, discover() { return { candidates: [], selectionRequired: true }; },
    async read(name) { calls.push(name); callback?.(name); if (name === 'get_usage_limits') return structuredClone(rawQuota); if (name === 'read_thread') return structuredClone(rawThread); return { threads: [{ id: target, kind: 'codex', hostId: 'local', status: 'notLoaded', title: 'private-title', summary: 'private-body' }], nextCursor: null }; },
  };
  const service = new CodexReadonlyService(provider, { read() { return structuredClone(goal); } }, { now: () => now, newId: () => id, digest: v => createHash('sha256').update(v).digest('hex') });
  return { service, calls, provider, setQuota(v: unknown) { rawQuota = v; }, setThread(v: unknown) { rawThread = v; }, setGoal(v: GoalState) { goal = v; }, onRead(fn: (name: string) => void) { callback = fn; }, advance(ms: number) { now += ms; } };
}
const code = (expected: string) => (error: unknown) => error instanceof Error && 'code' in error && error.code === expected;

test('账号内部观察不增加读取，时间回退/过期/断连不可作新鲜身份',async()=>{const f=setup();assert.equal(f.service.accountObservation().verified,false);await f.service.start();const reads=f.calls.length;assert.equal(f.service.accountObservation().stale,false);assert.equal(f.service.accountObservation().verified,true);assert.equal(f.calls.length,reads);f.advance(-1);assert.equal(f.service.accountObservation().stale,true);f.advance(30002);assert.equal(f.service.accountObservation().stale,true);f.service.close();assert.equal(f.service.accountObservation().verified,false);});
test('真实服务构造不读；缓存只带脱敏额度，三十秒后过期不冒充可用', async () => {
  const f = setup(); assert.equal(f.calls.length, 0); await f.service.start(); const result = f.service.getQuota(); assert.equal(result.available, true); assert.equal(result.source, 'live'); assert(!JSON.stringify(result).includes('private-account')); const reads = f.calls.length;
  f.advance(30001); assert.equal(f.service.getQuota().stale, true); assert.equal(f.service.getQuota().available, null); assert.equal(f.calls.length, reads); f.service.close(); assert.throws(() => f.service.getQuota(), code('PROVIDER_UNAVAILABLE'));
});
test('新额度桶缺失和缺窗口保持 unknown，不回退旧单桶，不依预计重置放行', async () => {
  for (const raw of [{ ...quota(), rateLimitsByLimitId: {} }, { ...quota(), rateLimitsByLimitId: { codex: { primary: { usedPercent: 10 } } } }]) { const f = setup(); f.setQuota(raw); await f.service.start(); assert.equal(f.service.getQuota().available, null); }
  const f = setup(); f.setQuota({ ...quota(), rateLimitsByLimitId: { codex: { primary: { usedPercent: 100, resetsAt: 1 }, secondary: { usedPercent: 0 } } } }); await f.service.start(); assert.equal(f.service.getQuota().available, false);
});
test('ordinaryUsageAllowed 为 null 或缺失时，低百分比不能作为额度恢复证据',async()=>{for(const flag of [null,undefined]){const f=setup();f.setQuota({...quota(),ordinaryUsageAllowed:flag});await f.service.start();assert.equal(f.service.getQuota().available,null);}});
test('非法额度、账号缺失及刷新失败不能保留虚假新快照', async () => {
  const f = setup(); await f.service.start(); f.setQuota({ ...quota(), rateLimitsByLimitId: { codex: { primary: { usedPercent: -1 } } } }); await assert.rejects(f.service.refresh(), code('PROVIDER_SCHEMA_UNSUPPORTED')); assert.throws(() => f.service.getQuota(), code('PROVIDER_SCHEMA_UNSUPPORTED'));
  const missing = setup(); missing.setQuota({ rateLimits: {} }); await missing.service.start(); assert.equal(missing.service.status().identityVerified, false); assert.throws(() => missing.service.getQuota(), code('PROVIDER_IDENTITY_UNAVAILABLE'));
});
test('并发刷新合并为一次底层读取', async () => {
  const f = setup(); await f.service.start(); const count = f.calls.length; await Promise.all([f.service.refresh(), f.service.refresh(), f.service.refresh()]); assert.equal(f.calls.length, count + 1);
});
test('在途读取身份缺失后丢弃原额度缓存，不能继续宣称账号已验证', async () => {
  const f = setup(); await f.service.start(); f.setQuota({ rateLimits: {} });
  await assert.rejects(f.service.list({ connectionId: id, limit: 2 }), code('PROVIDER_IDENTITY_UNAVAILABLE')); assert.equal(f.service.status().identityVerified, false); assert.throws(() => f.service.getQuota(), code('PROVIDER_IDENTITY_UNAVAILABLE'));
});
test('会话列表和读取仅投影状态，正文、标题、摘要和 Goal objective 不返回', async () => {
  const f = setup(); await f.service.start(); const list = await f.service.list({ connectionId: id, limit: 2, archived: false }); const thread = await f.service.thread({ connectionId: id, threadId: target });
  assert(!JSON.stringify({ list, thread }).includes('private-')); assert.deepEqual(thread.latestTurn, { id: 'turn-1', status: 'inProgress' }); assert.equal(thread.completionConfirmed, false); assert.equal(thread.goalAccountBindingVerified, false);
});
test('读取前后账号切换使修订失效，不返回已读取的目标结果', async () => {
  const f = setup(); await f.service.start(); f.onRead(name => { if (name === 'list_threads') f.setQuota({ ...quota(), accountId: 'changed-account' }); });
  await assert.rejects(f.service.list({ connectionId: id, limit: 2 }), code('CONNECTION_IDENTITY_CHANGED')); assert.equal(f.service.status().revision, 2); assert.equal(f.service.status().state, 'identity_changed'); await assert.rejects(f.service.refresh(), code('CONNECTION_IDENTITY_CHANGED'));
});
test('目标或连接身份不匹配拒绝；未知会话状态和 notLoaded 均不推断完成', async () => {
  const f = setup(); await f.service.start(); await assert.rejects(f.service.thread({ connectionId: 'wrong', threadId: target }), code('CONNECTION_IDENTITY_CHANGED'));
  f.setThread({ thread: { id: id, kind: 'codex', hostId: 'local', status: { type: 'active' } }, turns: [] }); await assert.rejects(f.service.thread({ connectionId: id, threadId: target }), code('TARGET_IDENTITY_MISMATCH'));
  for (const state of ['notLoaded', 'future-state']) { f.setThread({ thread: { id: target, kind: 'codex', hostId: 'local', status: { type: state } }, turns: [] }); const r = await f.service.thread({ connectionId: id, threadId: target }); assert.equal(r.completionConfirmed, false); assert.equal(r.statusKnown, state === 'notLoaded'); }
});
test('Goal 两次观察变化返回冲突；unknown 与确认无行严格区分', async () => {
  const f = setup(); await f.service.start(); f.onRead(name => { if (name === 'read_thread') f.setGoal({ availability: 'known', current: { id: 'new', status: 'active' }, reason: null }); });
  await assert.rejects(f.service.goal({ connectionId: id, threadId: target }), code('GOAL_IDENTITY_CHANGED'));
  const missing = setup(); missing.setGoal({ availability: 'unknown', current: null, reason: 'goal_database_missing' }); await missing.service.start(); assert.equal((await missing.service.goal({ connectionId: id, threadId: target })).availability, 'unknown');
  const none = setup(); await none.service.start(); assert.equal((await none.service.goal({ connectionId: id, threadId: target })).availability, 'known');
});
test('Goal 只读库缺失不创建文件，兼容字段与六种状态读取且不读 objective', () => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-dog-g04-goal-')); const path = join(directory, 'goals_1.sqlite'); const reader = new CodexGoalReadonly(directory);
  assert.equal(reader.read(target).reason, 'goal_database_missing'); assert(!existsSync(path));
  const db = new DatabaseSync(path); db.exec('CREATE TABLE thread_goals(thread_id TEXT PRIMARY KEY,goal_id TEXT,status TEXT,objective TEXT)'); db.close();
  for (const status of ['active', 'paused', 'blocked', 'usage_limited', 'budget_limited', 'complete']) {
    const writer = new DatabaseSync(path); writer.prepare('INSERT OR REPLACE INTO thread_goals VALUES(?,?,?,?)').run(target, 'goal-1', status, 'private-objective'); writer.close(); const before = readFileSync(path); assert.deepEqual(reader.read(target), { availability: 'known', current: { id: 'goal-1', status }, reason: null }); assert.deepEqual(readFileSync(path), before);
  }
  assert.equal(reader.read(id).availability, 'known');
});
test('Goal 未知结构/状态保守 unknown，不把失败变成无 Goal', () => {
  for (const schema of ["CREATE TABLE thread_goals(wrong TEXT)", `CREATE TABLE thread_goals(thread_id TEXT,goal_id TEXT,status TEXT); INSERT INTO thread_goals VALUES('${target}','g','future')`]) {
    const directory = mkdtempSync(join(tmpdir(), 'codex-dog-g04-bad-')); const db = new DatabaseSync(join(directory, 'goals_1.sqlite')); db.exec(schema); db.close(); assert.equal(new CodexGoalReadonly(directory).read(target).availability, 'unknown');
  }
});

async function fakeDesktop(mode: 'normal' | 'schema' | 'timeout' | 'disconnect' | 'oversize' | 'json' = 'normal') {
  const pipe = '\\\\.\\pipe\\codex-app-tools-g04-fixture-' + randomUUID(); const seen: string[] = []; const sockets = new Set<import('node:net').Socket>();
  const catalog = ['get_usage_limits', 'list_threads', 'read_thread'].map(name => ({ name, namespace: 'codex_app', inputSchema: { properties: Object.fromEntries((name === 'get_usage_limits' ? [] : name === 'list_threads' ? ['mode', 'source', 'hostId', 'limit', 'archived', 'cursor'] : ['threadId', 'hostId', 'turnLimit', 'includeOutputs', 'maxOutputCharsPerItem']).map(k => [k, {}])) } }));
  const server = createServer(socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); let buffer = Buffer.alloc(0);
    socket.on('data', data => { buffer = Buffer.concat([buffer, data]); while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
      const size = buffer.readUInt32LE(0); const request = JSON.parse(buffer.subarray(4, size + 4).toString('utf8')); buffer = buffer.subarray(size + 4); seen.push(request.method === 'tools/call' ? request.params.tool : request.method);
      if (request.method === 'tools/call' && mode === 'timeout') continue;
      if (request.method === 'tools/call' && mode === 'disconnect') { socket.destroy(); continue; }
      if (request.method === 'tools/call' && mode === 'oversize') { const h = Buffer.alloc(4); h.writeUInt32LE(8 * 1024 * 1024 + 1); socket.write(h); continue; }
      const result = request.method === 'tools/list' ? { tools: mode === 'schema' ? [] : catalog } : { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify({ marker: '中文', ...quota() }) }] };
      const payload = Buffer.from(request.method === 'tools/call' && mode === 'json' ? '{bad-json' : JSON.stringify({ id: request.id, result })); const header = Buffer.alloc(4); header.writeUInt32LE(payload.length); socket.write(header.subarray(0, 2)); socket.write(Buffer.concat([header.subarray(2), payload]));
    } });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(pipe, resolve); });
  return { pipe, seen, async close() { for (const s of sockets) s.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
test('桌面适配只允许固定读取和有界无正文参数，目录只保留探测通过的工具', async () => {
  const fake = await fakeDesktop(); const reader = new CodexDesktopReadonly({ pipe: fake.pipe, callerThreadId: target });
  try {
    await assert.rejects(reader.read('send_message_to_thread' as ReadTool, {}), code('PERMISSION_DENIED'));
    await assert.rejects(reader.read('read_thread', { threadId: target, hostId: 'local', turnLimit: 1, includeOutputs: true, maxOutputCharsPerItem: 0 }), code('PERMISSION_DENIED'));
    const result = await reader.read('get_usage_limits', {}) as { marker: string }; assert.equal(result.marker, '中文'); assert.deepEqual(fake.seen, ['tools/list', 'get_usage_limits']); assert.deepEqual(reader.audit(), { get_usage_limits: 1 });
  } finally { reader.close(); await fake.close(); }
});
for (const mode of ['schema', 'timeout', 'disconnect', 'oversize', 'json'] as const) test(`桌面 ${mode} 异常有界失败，不返回旧值或记录原始响应`, async () => {
  const fake = await fakeDesktop(mode); const reader = new CodexDesktopReadonly({ pipe: fake.pipe, callerThreadId: target, timeoutMs: 200 });
  try { await assert.rejects(reader.read('get_usage_limits', {})); assert.equal(reader.connected(), false); }
  finally { reader.close(); await fake.close(); }
});
test('无调用身份、多管道及外部路径不猜选，不发工具调用', async () => {
  const missing = new CodexDesktopReadonly({ discoverNames: () => [] }); await assert.rejects(missing.start(), code('PROVIDER_SELECTION_REQUIRED'));
  const multiple = new CodexDesktopReadonly({ callerThreadId: target, discoverNames: () => ['codex-app-tools-a', 'codex-app-tools-b'] }); await assert.rejects(multiple.start(), code('PROVIDER_SELECTION_REQUIRED')); assert.equal(multiple.discover().selectionRequired, true);
  const foreign = new CodexDesktopReadonly({ callerThreadId: target, pipe: '\\\\remote\\pipe\\codex-app-tools-a' }); await assert.rejects(foreign.start(), code('PROVIDER_SELECTION_REQUIRED'));
});
