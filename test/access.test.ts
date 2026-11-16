import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AccessService } from '../packages/modules/access/service.ts';
import type { AccessState, Principal } from '../packages/modules/access/service.ts';
import { HostRouter } from '../packages/app/router.ts';
import { apiVersion } from '../packages/contracts/protocol.ts';
import type { Response } from '../packages/contracts/protocol.ts';

const desktop: Principal = { kind: 'desktop', clientId: 'desktop', revision: 1, scopes: ['read', 'access.manage'] };
function setup() {
  let state: AccessState = { schemaVersion: 1, clients: [], requests: [] };
  let now = Date.UTC(2026, 10, 16); let loads = 0; let failSave = false;
  const credential = { clientId: randomUUID(), secret: randomBytes(32).toString('hex') };
  const service = new AccessService({ store: { async load() { loads++; return structuredClone(state); }, async save(next) { if (failSave) throw new Error('failure'); state = structuredClone(next); } }, now: () => now,
    digest: text => createHash('sha256').update(text).digest('hex'), equal: (a, b) => a === b, newCode: () => 'ABC123' });
  const request = () => service.request(credential, { clientLabel: 'test-client', requestedScopes: ['read'] }, 'pair');
  const grant = () => service.grant(desktop, { id: credential.clientId, expectedRevision: 1, code: 'ABC123', scopes: ['read'], expiresAt: null }, 'grant');
  return { service, credential, request, grant, state: () => state, loads: () => loads, advance: (ms: number) => { now += ms; }, failSave: () => { failSave = true; } };
}
const code = (expected: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === expected;
test('授权构造无读取；配对前后权限及凭据脱敏', async () => {
  const f = setup(); assert.equal(f.loads(), 0); await f.service.start(); assert.equal(f.loads(), 1);
  assert.throws(() => f.service.authenticate(), code('AUTH_REQUIRED'));
  await f.request(); assert.throws(() => f.service.authenticate(f.credential), code('AUTH_REQUIRED'));
  await f.grant(); assert.deepEqual(f.service.authenticate(f.credential).scopes, ['read']);
  assert(!JSON.stringify(f.state()).includes(f.credential.secret));
  assert(!JSON.stringify(f.service.list(desktop)).includes('secretHash'));
});
test('无管理权限不能自授；伪造凭据、配对码及扩大权限均拒绝', async () => {
  const f = setup(); await f.service.start(); await f.request();
  assert.throws(() => f.service.authenticate({ ...f.credential, secret: '0'.repeat(64) }), code('PERMISSION_DENIED'));
  await assert.rejects(async () => f.service.grant(desktop, { id: f.credential.clientId, expectedRevision: 1, code: '000000', scopes: ['read'], expiresAt: null }, 'wrong-code'), code('PERMISSION_DENIED'));
  await assert.rejects(async () => f.service.grant(desktop, { id: f.credential.clientId, expectedRevision: 1, code: 'ABC123', scopes: ['access.manage'], expiresAt: null }, 'expand'), code('PERMISSION_DENIED'));
  await f.grant(); const actor = f.service.authenticate(f.credential);
  await assert.rejects(async () => f.service.grant(actor, { id: f.credential.clientId, expectedRevision: 2, code: 'ABC123', scopes: ['read'], expiresAt: null }, 'self'), code('PERMISSION_DENIED'));
});
test('同键同参数回放；异参冲突；缺幂等键拒绝', async () => {
  const f = setup(); await f.service.start(); assert.deepEqual(await f.request(), await f.request());
  await assert.rejects(async () => f.service.request(f.credential, { clientLabel: 'other', requestedScopes: ['read'] }, 'pair'), code('IDEMPOTENCY_CONFLICT'));
  await assert.rejects(async () => f.service.request(f.credential, { clientLabel: 'test', requestedScopes: ['read'] }), code('INVALID_ARGUMENT'));
});
test('并发批准只成功一次，旧修订不可重写', async () => {
  const f = setup(); await f.service.start(); await f.request();
  const input = { id: f.credential.clientId, expectedRevision: 1, code: 'ABC123', scopes: ['read' as const], expiresAt: null };
  const result = await Promise.allSettled([f.service.grant(desktop, input, 'a'), f.service.grant(desktop, input, 'b')]);
  assert.equal(result.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(f.state().clients[0]!.revision, 2);
});
test('撤销立即失效，旧快照权限和已撤销凭据不能重用', async () => {
  const f = setup(); await f.service.start(); await f.request(); await f.grant();
  const actor = f.service.authenticate(f.credential);
  await f.service.revoke(desktop, { id: f.credential.clientId, expectedRevision: 2 }, 'revoke');
  assert.throws(() => f.service.authenticate(f.credential), code('AUTH_REVOKED'));
  assert.throws(() => f.service.assertCurrent(actor), code('AUTH_REVOKED'));
  await assert.rejects(async () => f.request(), code('AUTH_REVOKED'));
});
test('保存失败不产生内存授权；过期申请和授权不放行', async () => {
  const f = setup(); await f.service.start(); await f.request(); f.failSave();
  await assert.rejects(f.grant(), code('STORAGE_FAILURE')); assert.throws(() => f.service.authenticate(f.credential), code('AUTH_REQUIRED'));
  const expired = setup(); await expired.service.start(); await expired.request(); expired.advance(300001);
  await assert.rejects(expired.grant(), code('PAIRING_EXPIRED'));
  const ttl = setup(); await ttl.service.start(); await ttl.request();
  await ttl.service.grant(desktop, { id: ttl.credential.clientId, expectedRevision: 1, code: 'ABC123', scopes: ['read'], expiresAt: new Date(Date.UTC(2026, 10, 16) + 1000).toISOString() }, 'ttl');
  ttl.advance(1001); assert.throws(() => ttl.service.authenticate(ttl.credential), code('AUTH_REVOKED'));
});
test('慢读取返回前再次复核撤销，不能泄露已撤销结果', async () => {
  const f = setup(); await f.service.start(); await f.request(); await f.grant();
  let finish!: (value: Response) => void;
  const router = new HostRouter(f.service, { health: () => ({ state: 'running', workerPid: 123 }), invoke: () => new Promise(resolve => { finish = resolve; }) }, { runtimeId: 'host', handlerInstanceId: 'router' });
  const pending = router.invoke({ apiVersion, requestId: 'read', operation: 'quota.get', params: {} }, { credential: f.credential });
  await f.service.revoke(desktop, { id: f.credential.clientId, expectedRevision: 2 }, 'revoke');
  finish({ ok: true, data: { available: true }, meta: { apiVersion, requestId: 'read', source: 'fixture', runtimeId: 'worker', handlerInstanceId: 'quota', workerPid: 123 } });
  const result = await pending; assert(!result.ok); assert.equal(result.error.code, 'AUTH_REVOKED');
});
test('宿主入口拒绝客户端伪造权限，管理命令不绕过授权', async () => {
  const f = setup(); await f.service.start();
  const router = new HostRouter(f.service, { health: () => ({ state: 'running', workerPid: 123 }), invoke: async () => { throw new Error('should not run'); } }, { runtimeId: 'host', handlerInstanceId: 'router' });
  const raw = { apiVersion, requestId: 'a', operation: 'access.grant', params: { id: f.credential.clientId, expectedRevision: 1, code: 'ABC123', scopes: ['read'], expiresAt: null } };
  const unpaired = await router.invoke(raw, { credential: f.credential }); assert(!unpaired.ok); assert.equal(unpaired.error.code, 'PERMISSION_DENIED');
  const forged = await router.invoke({ ...raw, scopes: ['access.manage'] }, { credential: f.credential }); assert(!forged.ok); assert.equal(forged.error.code, 'INVALID_ARGUMENT');
});
