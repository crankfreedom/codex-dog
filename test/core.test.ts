import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApplicationRegistry } from '../packages/app/registry.ts';
import { FixtureUsageReader } from '../packages/infrastructure/fixture-usage.ts';
import type { UsageReadPort, UsageObservation } from '../packages/modules/quota/service.ts';
import { apiVersion, definitions, describe } from '../packages/contracts/protocol.ts';

const identity = { runtimeId: 'test-runtime', handlerInstanceId: 'test-handler', workerPid: 123 };
const request = (operation = 'quota.get', params: Record<string, unknown> = {}) => ({ apiVersion, requestId: 'request-1', operation, params });
test('构造无读取，start 初始化一次，quota.get 只返回快照副本', async () => {
  const reader = new FixtureUsageReader('available', () => new Date('2026-11-16T00:00:00Z'));
  const registry = new ApplicationRegistry(reader, identity);
  assert.equal(reader.reads, 0);
  assert.equal(registry.invoke(request(), ['read']).ok, false);
  await registry.start();
  const first = registry.invoke(request(), ['read']); assert(first.ok);
  assert.equal(first.data.available, true); assert.equal(first.data.source, 'fixture');
  assert.equal(first.meta.handlerInstanceId, identity.handlerInstanceId);
  (first.data.windows as Array<{ usedPercent: number }>)[0]!.usedPercent = 99;
  const second = registry.invoke(request(), ['read']); assert(second.ok);
  assert.equal((second.data.windows as Array<{ usedPercent: number }>)[0]!.usedPercent, 25);
  assert.equal(reader.reads, 1);
  registry.close(); assert.equal(registry.invoke(request(), ['read']).ok, false);
});
for (const [scenario, expected] of [['blocked', false], ['unknown', null]] as const) test(`${scenario} 不冒充额度可用`, async () => {
  const registry = new ApplicationRegistry(new FixtureUsageReader(scenario), identity); await registry.start();
  const result = registry.invoke(request(), ['read']); assert(result.ok); assert.equal(result.data.available, expected);
});
test('统一入口拒绝未知参数、权限缺失、未实现能力和协议不兼容', async () => {
  const registry = new ApplicationRegistry(new FixtureUsageReader('available'), identity); await registry.start();
  for (const [raw, scopes, expected] of [
    [request('quota.get', { injected: true }), ['read'], 'INVALID_ARGUMENT'],
    [request(), [], 'PERMISSION_DENIED'],
    [request('threads.send'), ['read'], 'CAPABILITY_UNSUPPORTED'],
    [{ ...request(), apiVersion: '99' }, ['read'], 'PROTOCOL_INCOMPATIBLE'],
    [{ ...request(), scopes: ['admin'] }, ['read'], 'INVALID_ARGUMENT'],
  ] as const) { const result = registry.invoke(raw, scopes); assert(!result.ok); assert.equal(result.error.code, expected); }
});
test('能力发现只列已实现能力且使用同一输入 Schema', async () => {
  assert.equal(definitions.length, 23); assert(!definitions.some(c => String(c.operation) === 'threads.send'));
  assert.equal(describe('quota.get')!.inputSchema.additionalProperties, false);
  assert.equal(describe('access.grant')!.readOnly, false);
});
test('数据源失败时不能让应用进入就绪', async () => {
  const bad: UsageReadPort = { async read() { throw new Error('unavailable'); } };
  const registry = new ApplicationRegistry(bad, identity); await assert.rejects(registry.start());
  const result = registry.invoke(request(), ['read']); assert(!result.ok); assert.equal(result.error.code, 'APP_NOT_READY');
});
test('G01 不能接受伪装真实来源、重复窗口或非法额度值', async () => {
  const valid: UsageObservation = { source: 'fixture', observedAt: '2026-11-16T00:00:00Z', windows: [{ name: 'five-hour', usedPercent: 25 }, { name: 'weekly', usedPercent: 40 }] };
  for (const observation of [
    { ...valid, source: 'live' },
    { ...valid, windows: [{ name: 'weekly', usedPercent: 20 }, { name: 'weekly', usedPercent: 30 }] },
    { ...valid, windows: [{ name: 'five-hour', usedPercent: -1 }, { name: 'weekly', usedPercent: 40 }] },
  ]) {
    const registry = new ApplicationRegistry({ async read() { return observation as UsageObservation; } }, identity);
    await assert.rejects(registry.start());
  }
});
