import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { SourceConfiguration, defaultSourceState } from '../packages/app/source-configuration.ts';
import { FileSourceStore } from '../packages/infrastructure/source-store.ts';
import { sourceConfigureParams, apiVersion } from '../packages/contracts/protocol.ts';
import { quotaPresentation } from '../apps/desktop/renderer/quota-view.ts';
import type { QuotaSnapshot } from '../apps/desktop/renderer/quota-view.ts';
import { AccessService } from '../packages/modules/access/service.ts';
import { HostRouter } from '../packages/app/router.ts';
const input = { expectedRevision: 1, source: 'live-readonly' as const, callerThreadId: randomUUID(), pipe: '\\\\.\\pipe\\codex-app-tools-fixture' };
const code = (expected: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === expected;
test('来源构造无 I/O，显式保存仅下次启动生效，幂等与修订跨重启保留', async () => {
  let reads = 0; let state = defaultSourceState();
  const store = { async load() { reads++; return structuredClone(state); }, async save(value: typeof state) { state = structuredClone(value); } };
  const service = new SourceConfiguration(store); assert.equal(reads, 0); await service.start({});
  const result = await service.configure(input, 'actor', 'key', () => {});
  assert.equal((service.get().active as { source: string }).source, 'fixture'); assert.equal(result.restartRequired, true);
  assert.deepEqual(await service.configure(input, 'actor', 'key', () => {}), result);
  await assert.rejects(service.configure({ ...input, pipe: '' }, 'actor', 'key', () => {}), code('IDEMPOTENCY_CONFLICT'));
  const next = new SourceConfiguration(store); assert.deepEqual(await next.start({}, randomUUID()), state.selection); assert.equal(next.get().override, false);
  assert.deepEqual(await next.configure(input, 'actor', 'key', () => {}), result);
  await assert.rejects(next.configure(input, 'other', 'key', () => {}), code('REVISION_CONFLICT'));
  await service.close();
});
test('并发来源保存只成功一次，存储失败与撤销不改变选择，无幂等键拒绝', async () => {
  let state = defaultSourceState(); let fail = false;
  const service = new SourceConfiguration({ async load() { return state; }, async save(value) { if (fail) throw new Error(); state = value; } }); await service.start({});
  await assert.rejects(service.configure(input, 'a', undefined, () => {}), code('INVALID_ARGUMENT'));
  await assert.rejects(service.configure(input, 'a', 'revoked', () => { throw Object.assign(new Error(), { code: 'AUTH_REVOKED' }); }), code('AUTH_REVOKED'));
  fail = true; await assert.rejects(service.configure(input, 'a', 'fail', () => {}), code('STORAGE_FAILURE')); assert.equal(service.get().revision, 1);
  fail = false; const results = await Promise.allSettled(['one', 'two'].map(key => service.configure(input, 'a', key, () => {}))); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});
test('来源文件原子保存、未来版本失败关闭；启动参数仅覆盖本次而不修改持久选择', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dog-source-')); const file = join(directory, 'source.json'); const store = new FileSourceStore(file);
  const service = new SourceConfiguration(store); await service.start({}); await service.configure(input, 'a', 'save', () => {});
  assert.deepEqual(await readdir(directory), ['source.json']);
  const second = new SourceConfiguration(store); assert.equal((await second.start({ source: 'fixture' })).source, 'fixture'); assert.equal(second.get().override, true); assert.equal((second.get().saved as { source: string }).source, 'live-readonly');
  await writeFile(file, JSON.stringify({ ...defaultSourceState(), schemaVersion: 99 })); await assert.rejects(new SourceConfiguration(store).start({}));
});
test('真实来源必须明确调用会话，任意文件/远程管道不能成为连接目标', () => {
  assert(sourceConfigureParams.safeParse(input).success);
  for (const patch of [{ callerThreadId: '' }, { pipe: 'C:\\Windows\\test' }, { pipe: '\\\\remote\\pipe\\codex-app-tools-x' }, { source: 'auto' }, { callerThreadId: 'guess' }]) assert(!sourceConfigureParams.safeParse({ ...input, ...patch }).success);
});

test('真实卡来源接受明确的 Windows codex.exe 路径，拒绝相对、UNC、错误文件和控制字符',()=>{
 for(const cardExecutable of ['C:/tools/codex.exe','C:\\Program Files\\OpenAI\\resources\\codex.exe','D:/中文 空格/runner/codex.exe'])assert(sourceConfigureParams.safeParse({...input,cardExecutable,allowCardConsumption:false}).success,cardExecutable);
 for(const cardExecutable of ['codex.exe','../codex.exe','/tools/codex.exe','\\\\server\\tools\\codex.exe','C:/tools/other.exe','C:/tools/codex.exe --help','C:/bad\npath/codex.exe','C:/bad\rpath/codex.exe','C:/bad\u0000path/codex.exe','C:/bad"path/codex.exe'])assert(!sourceConfigureParams.safeParse({...input,cardExecutable}).success,JSON.stringify(cardExecutable));
});

test('真实卡路径与关闭的消费开关经文件保存/重启保留，切回模拟不继承真实卡选项',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'dog-card-source-')),store=new FileSourceStore(join(directory,'source.json')),service=new SourceConfiguration(store);await service.start({});
 const selection={...input,cardExecutable:'C:/Program Files/OpenAI/resources/codex.exe',allowCardConsumption:false};await service.configure(selection,'actor','card-source',()=>{});assert.equal((service.get().active as {source:string}).source,'fixture');await service.close();
 const restarted=new SourceConfiguration(store),active=await restarted.start({});assert.equal(active.cardExecutable,selection.cardExecutable);assert.equal(active.allowCardConsumption,false);
 const fixture=await restarted.configure({expectedRevision:2,source:'fixture',callerThreadId:'',pipe:''},'actor','fixture',()=>{});assert.deepEqual(fixture.saved,{source:'fixture',callerThreadId:'',pipe:''});await restarted.close();
});
test('过期、断线、未知与服务失败不能用旧观察展示正常，耗尽保持阻断', () => {
  const now = Date.now(); const snapshot: QuotaSnapshot = { source: 'live', observedAt: new Date(now).toISOString(), stale: false, available: true, reason: 'quota_available', windows: ['primary', 'secondary'].map(name => ({ name, usedPercent: 20, remainingPercent: 80 })) };
  const view = (s = snapshot, running = true, connected = true, error = '', at = now) => quotaPresentation(s, 'live-readonly', running, connected, error, at);
  assert.equal(view().tone, 'good'); assert.equal(view(snapshot, true, true, '', now + 30001).label, '观察已过期');
  assert.equal(view(snapshot, true, false).tone, 'unknown'); assert.equal(view(snapshot, false).tone, 'unknown'); assert.equal(view(snapshot, true, true, 'READ_TIMEOUT').tone, 'unknown');
  assert.equal(view({ ...snapshot, available: null }).tone, 'unknown'); assert.equal(view({ ...snapshot, available: false }).tone, 'blocked'); assert.equal(view({ ...snapshot, windows: [] }).tone, 'unknown');
});
test('桌面平台操作统一授权，错误实例拒绝退出，同键不重复安排；退出派发再次复核撤销', async () => {
  let state = { schemaVersion: 1 as const, clients: [], requests: [] } as import('../packages/modules/access/service.ts').AccessState;
  const access = new AccessService({ store: { async load() { return state; }, async save(value) { state = value; } }, now: Date.now, newCode: () => 'ABC123', digest: value => value, equal: (a, b) => a === b }); await access.start();
  const credential = { clientId: randomUUID(), secret: 'a'.repeat(64) }; await access.request(credential, { clientLabel: 'read', requestedScopes: ['read', 'app.manage'] }, 'pair');
  const desktop = { kind: 'desktop' as const, clientId: 'desktop', revision: 1, scopes: ['read' as const, 'access.manage' as const, 'app.manage' as const] };
  await access.grant(desktop, { id: credential.clientId, expectedRevision: 1, code: 'ABC123', scopes: ['read'], expiresAt: null }, 'read');
  let shows = 0; let exits = 0; let finalGuard: (() => void) | undefined; const instance = randomUUID();
  const configuration = new SourceConfiguration({ async load() { return defaultSourceState(); }, async save() {} }); await configuration.start({});
  const router = new HostRouter(access, { health: () => ({ state: 'running', workerPid: 123 }), async invoke() { throw new Error(); } }, { runtimeId: instance, handlerInstanceId: 'router' }, 'fixture', undefined, { configuration, desktop: { show() { shows++; }, quit(guard) { exits++; finalGuard = guard; }, status: () => ({ trayAvailable: true }) } });
  const invoke = (operation: string, params = {}, key = 'k') => router.invoke({ apiVersion, requestId: 'p', operation, params, idempotencyKey: key }, { credential });
  assert((await invoke('desktop.show')).ok); assert.equal(shows, 1);
  assert.equal((await invoke('app.quit', { expectedInstanceId: instance, confirm: true })).ok, false); assert.equal(exits, 0);
  const full = { clientId: randomUUID(), secret: 'b'.repeat(64) }; await access.request(full, { clientLabel: 'admin', requestedScopes: ['read', 'app.manage'] }, 'pair-admin'); await access.grant(desktop, { id: full.clientId, expectedRevision: 1, code: 'ABC123', scopes: ['read', 'app.manage'], expiresAt: null }, 'grant-admin');
  const quit = (id: string) => router.invoke({ apiVersion, requestId: 'q', operation: 'app.quit', params: { expectedInstanceId: id, confirm: true }, idempotencyKey: 'exit' }, { credential: full });
  assert.equal((await quit(randomUUID())).ok, false); assert.equal(exits, 0);
  assert((await quit(instance)).ok); assert((await quit(instance)).ok); assert.equal(exits, 1); finalGuard!();
  await access.revoke(desktop, { id: full.clientId, expectedRevision: 2 }, 'revoke'); assert.throws(finalGuard!, code('AUTH_REVOKED'));
  router.stop(); assert.equal((await invoke('desktop.show')).ok, false);
});
