import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkerSupervisor } from '../packages/app/worker-supervisor.ts';
import type { RuntimeChild, SupervisorOptions } from '../packages/app/worker-supervisor.ts';
import { apiVersion } from '../packages/contracts/protocol.ts';

class Child implements RuntimeChild {
  pid = 123; killed = false; hold = false;
  messages: Array<(message: unknown) => void> = []; exits: Array<() => void> = [];
  constructor(ready = true) { if (ready) queueMicrotask(() => this.emit({ type: 'ready' })); }
  onMessage(listener: (message: unknown) => void) { this.messages.push(listener); }
  onExit(listener: () => void) { this.exits.push(listener); }
  emit(message: unknown) { for (const listener of this.messages) listener(message); }
  send(value: unknown) { const message = value as { type: string }; if (message.type === 'stop') this.kill(); }
  kill() { if (!this.killed) { this.killed = true; queueMicrotask(() => this.exits.forEach(listener => listener())); } }
}
async function until(check: () => boolean) { const start = Date.now(); while (!check()) { if (Date.now() - start > 2000) throw new Error('wait timeout'); await new Promise(resolve => setTimeout(resolve, 5)); } }
function setup(options: Partial<SupervisorOptions> = {}) {
  const children: Child[] = []; let now = 1000;
  const supervisor = new WorkerSupervisor({ spawn: () => { const child = new Child(); children.push(child); return child; }, newId: () => 'id-' + Math.random(), now: () => now, restartDelay: 5, heartbeatTimeout: 100000, ...options });
  return { supervisor, children, advance: (ms: number) => { now += ms; } };
}
const request = { apiVersion, requestId: 'a', operation: 'quota.get', params: {} } as const;
test('构造不启动；心跳超时取消在途读取并有限重启', async () => {
  const f = setup({ heartbeatTimeout: 10 }); assert.equal(f.children.length, 0);
  await f.supervisor.start(); const pending = f.supervisor.invoke(request); f.advance(20);
  await until(() => f.children.length === 2);
  const result = await pending; assert(!result.ok); assert.equal(result.error.code, 'APP_NOT_READY');
  assert(f.children[0]!.killed); assert.equal(f.supervisor.health().restartCount, 1); await f.supervisor.stop();
});
test('崩溃重启预算不会在 ready 后重置，耗尽后稳定失败', async () => {
  const f = setup({ maxRestarts: 2 }); await f.supervisor.start();
  for (let i = 0; i < 3; i++) { f.children[i]!.kill(); await until(() => i === 2 ? f.supervisor.health().state === 'failed' : f.children.length === i + 2); }
  assert.equal(f.children.length, 3); assert.equal(f.supervisor.health().restartCount, 2);
  const result = await f.supervisor.invoke(request); assert(!result.ok); assert.equal(result.error.code, 'APP_NOT_READY'); await f.supervisor.stop();
});
test('退出取消已排队重启，并清理等待中的请求', async () => {
  const f = setup({ restartDelay: 100 }); await f.supervisor.start();
  const pending = f.supervisor.invoke(request); f.children[0]!.kill(); await until(() => f.supervisor.health().state === 'restarting');
  await f.supervisor.stop(); await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(f.children.length, 1); assert.equal((await pending).ok, false); assert.equal(f.supervisor.health().state, 'stopped');
});
test('读取超时和启动失败均有界，失败不会使请求永久等待', async () => {
  const f = setup({ requestTimeout: 10 }); await f.supervisor.start(); const result = await f.supervisor.invoke(request); assert(!result.ok); assert.equal(result.error.code, 'READ_TIMEOUT'); await f.supervisor.stop();
  const child = new Child(false); const supervisor = new WorkerSupervisor({ spawn: () => child, newId: () => 'x', now: () => 1, startupTimeout: 10, maxRestarts: 0 });
  await assert.rejects(supervisor.start()); await supervisor.stop(); assert(child.killed);
});
