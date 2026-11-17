import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { UpdateService } from '../packages/update/service.ts';
import { emptyUpdateState, UpdateError } from '../packages/update/ports.ts';
import type { UpdateBackendPort, UpdateState } from '../packages/update/ports.ts';

function setup(version = '0.5.0-beta.1', saved = emptyUpdateState()) {
  let state = structuredClone(saved); let reads = 0; let saves = 0; let installs = 0; let backups = 0; let blocked: string | null = null; let failSave = false; let revoked = false;
  let candidate: { version: string; fileName: string; sha512: string; size: number } | null = { version: '0.5.0-beta.2', fileName: 'test.exe', sha512: 'hash', size: 100 };
  const backend: UpdateBackendPort = { supported: () => true, async check() { reads++; return candidate; }, async download(c) { if (blocked === 'download') throw new UpdateError('UPDATE_DOWNLOAD_FAILED', '失败'); return { version: c.version, path: '/private/cache.exe', sha512: c.sha512, size: 100 }; }, async verify() { if (blocked === 'hash') throw new UpdateError('UPDATE_INTEGRITY_FAILED', '失败'); }, cancel() {} };
  const service = new UpdateService({ backend, version, now: Date.now, newId: randomUUID, digest: text => createHash('sha256').update(text).digest('hex'), store: { async load() { reads++; return state; }, async save(value) { saves++; if (failSave) throw new Error('storage'); state = structuredClone(value); } }, lifecycle: { async prepare() { if (blocked === 'cli') throw new UpdateError('CLI_IN_USE', '占用'); if (blocked === 'backup') throw new UpdateError('STORAGE_FAILURE', '备份失败'); backups++; }, async install(_, finalGuard) { if (blocked === 'cleanup') throw new UpdateError('UPDATE_EXIT_FAILED', '退出失败'); if (blocked === 'late-revoke') revoked = true; finalGuard(); installs++; } } });
  return { service, backend, get: () => ({ state, reads, saves, installs, backups }), setBlock(value: string | null) { blocked = value; }, setCandidate(value: typeof candidate) { candidate = value; }, failSave() { failSave = true; }, revoke() { revoked = true; }, guard() { if (revoked) throw new UpdateError('AUTH_REVOKED', '撤销'); } };
}
async function settled(service: UpdateService) { for (let i = 0; i < 100; i++) { if (!['downloading', 'installing'].includes(service.status().phase)) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('更新未落定'); }
async function download(f: ReturnType<typeof setup>) { await f.service.check(); const c = f.service.status().candidate!; const params = { candidateId: c.id, expectedVersion: c.version }; await f.service.request('download', 'client', params, 'download', f.guard); await settled(f.service); return { artifactId: f.service.status().artifact!.id, expectedVersion: c.version, confirm: true }; }
test('更新构造无 IO，未安装状态不隐式联网；状态不暴露路径/幂等键或可变引用', async () => {
  const f = setup(); assert.equal(f.get().reads, 0); await f.service.start(); const reads = f.get().reads; f.service.status(); assert.equal(f.get().reads, reads);
  await download(f); const result = f.service.status(); assert(!JSON.stringify(result).includes('/private/')); assert(!JSON.stringify(result).includes('digest')); result.candidate!.version = 'changed'; assert.equal(f.service.status().candidate!.version, '0.5.0-beta.2'); await f.service.close();
});
test('更新配置保持固定通道、独立修订与持久幂等，旧授权复核，关闭取消计时器',async()=>{
 const f=setup();await f.service.start();const input={expectedRevision:1,channel:'beta' as const,automaticCheck:true,intervalSeconds:3600,automaticDownload:false as const};const saved=await f.service.configure('client',input,'policy',f.guard);assert.equal(saved.revision,2);assert.equal(f.get().installs,0);assert.deepEqual(await f.service.configure('client',input,'policy',f.guard),saved);await assert.rejects(f.service.configure('client',{...input,channel:'stable'},'switch',f.guard),{code:'UPDATE_VERSION_REJECTED'});await assert.rejects(f.service.configure('client',{...input,intervalSeconds:7200},'policy',f.guard),{code:'IDEMPOTENCY_CONFLICT'});f.revoke();await assert.rejects(f.service.configure('client',{...input,expectedRevision:2},'revoked',f.guard),{code:'AUTH_REVOKED'});await f.service.close();
});
test('统一操作查询保持更新所有权，接受阶段可取消且不会派发下载',async()=>{
 const f=setup();await f.service.start();await f.service.check();const c=f.service.status().candidate!;const op=await f.service.request('download','client',{candidateId:c.id,expectedVersion:c.version},'download',f.guard);assert.equal(f.service.operation(op.operationId,'other'),null);assert.equal(f.service.operation(op.operationId,'client')!.kind,'updates.download');const cancelled=await f.service.cancelOperation(op.operationId,'client',false,'cancel',f.guard);assert.equal(cancelled.state,'cancelled');await settled(f.service);assert.equal(f.service.status().artifact,null);await f.service.close();
});
test('同版/降级/stable 候选拒绝，不自动下载或安装', async () => {
  for (const version of ['0.5.0-beta.1', '0.4.0-beta.2', '0.6.0']) { const f = setup(); await f.service.start(); f.setCandidate({ version, fileName: 'x.exe', sha512: 'h', size: 1 }); await assert.rejects(f.service.check()); assert.equal(f.get().installs, 0); }
});
test('下载持久幂等，同键回放/异参冲突，目标变化拒绝', async () => {
  const f = setup(); await f.service.start(); await download(f); const c = f.service.status().candidate!;
  assert.equal((await f.service.request('download', 'client', { candidateId: c.id, expectedVersion: c.version }, 'download', f.guard)).state, 'succeeded');
  await assert.rejects(f.service.request('download', 'client', { candidateId: c.id, expectedVersion: 'wrong' }, 'download', f.guard)); await assert.rejects(f.service.request('download', 'client', { candidateId: 'wrong', expectedVersion: c.version }, 'other', f.guard)); assert.equal(f.get().state.operations.length, 1); await f.service.close();
});
for (const block of ['cli', 'backup', 'hash', 'cleanup'] as const) test(`${block} 门禁失败不安装，旧版本可读且保留错误`, async () => {
  const f = setup(); await f.service.start(); const params = await download(f); f.setBlock(block); await f.service.request('install', 'client', params, 'install', f.guard); await settled(f.service); assert.equal(f.service.status().phase, 'failed'); assert.equal(f.get().installs, 0); assert(f.service.status().error); await f.service.close();
});
test('关闭占用后新操作可安装，重启验证版本相符才完成', async () => {
  const f = setup(); await f.service.start(); const params = await download(f); f.setBlock('cli'); await f.service.request('install', 'client', params, 'blocked', f.guard); await settled(f.service); f.setBlock(null);
  await f.service.request('install', 'client', params, 'retry', f.guard); await settled(f.service); assert.equal(f.service.status().phase, 'awaiting_restart'); assert.equal(f.get().installs, 1); const state = f.get().state; await f.service.close();
  const next = setup('0.5.0-beta.2', state); await next.service.start(); assert.equal(next.service.status().operations.at(-1)!.state, 'succeeded'); assert.equal(next.get().installs, 0);
});
test('旧版本重启、未完成操作不会自动重放安装', async () => {
  const f = setup(); await f.service.start(); const params = await download(f); await f.service.request('install', 'client', params, 'install', f.guard); await settled(f.service);
  const recovered = setup('0.5.0-beta.1', f.get().state); await recovered.service.start(); assert.equal(recovered.service.status().error, 'INSTALL_NOT_APPLIED'); assert.equal(recovered.get().installs, 0); await f.service.close();
});
test('撤销在异步边界复核，接受后撤销也不下载或安装', async () => {
  const f = setup(); await f.service.start(); await f.service.check(); const c = f.service.status().candidate!;
  await f.service.request('download', 'client', { candidateId: c.id, expectedVersion: c.version }, 'revoke', f.guard); f.revoke(); await settled(f.service); assert.equal(f.service.status().error, 'AUTH_REVOKED'); assert.equal(f.get().installs, 0); await f.service.close();
});
test('记录保存失败不创建接受的副作用；下载失败能明确核对', async () => {
  const f = setup(); await f.service.start(); await f.service.check(); const c = f.service.status().candidate!; f.failSave(); await assert.rejects(f.service.request('download', 'client', { candidateId: c.id, expectedVersion: c.version }, 'save-fail', f.guard)); assert.equal(f.get().installs, 0);
  const bad = setup(); await bad.service.start(); await bad.service.check(); bad.setBlock('download'); const b = bad.service.status().candidate!; await bad.service.request('download', 'client', { candidateId: b.id, expectedVersion: b.version }, 'network', bad.guard); await settled(bad.service); assert.equal(bad.service.status().error, 'UPDATE_DOWNLOAD_FAILED'); await bad.service.close();
});
test('接受后正常退出取消排队更新，不在退出时隐式安装', async () => {
  const f = setup(); await f.service.start(); await f.service.check(); const c = f.service.status().candidate!;
  await f.service.request('download', 'client', { candidateId: c.id, expectedVersion: c.version }, 'quit', f.guard); await f.service.close(); assert.equal(f.get().installs, 0); assert.equal(f.get().state.operations.at(-1)!.error, 'APP_STOPPING');
});
test('退出协调后、物理安装前仍复核授权，最后撤销也不启动安装器', async () => {
  const f = setup(); await f.service.start(); const params = await download(f); f.setBlock('late-revoke'); await f.service.request('install', 'client', params, 'last-guard', f.guard); await settled(f.service); assert.equal(f.get().installs, 0); assert.equal(f.service.status().error, 'AUTH_REVOKED'); await f.service.close();
});
