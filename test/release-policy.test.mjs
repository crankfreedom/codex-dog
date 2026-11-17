import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { releasePolicy } from '../build/release-policy.mjs';
import { parseDistribution } from '../packages/infrastructure/distribution.ts';
import { WindowsUpdateBackend } from '../packages/infrastructure/windows-update-backend.ts';
import { UpdateService } from '../packages/update/service.ts';
import { emptyUpdateState } from '../packages/update/ports.ts';
import { exitCode, failure } from '../packages/contracts/protocol.ts';

const environment = { DOG_SIGNING_ENABLED: 'true', DOG_PUBLISHER_NAME: '测试发布者', DOG_AZURE_ENDPOINT: 'https://eus.codesigning.azure.net/', DOG_AZURE_ACCOUNT: 'fixture', DOG_AZURE_CERTIFICATE_PROFILE: 'fixture', AZURE_TENANT_ID: 'fixture', AZURE_CLIENT_ID: 'fixture', AZURE_CLIENT_SECRET: 'not-a-real-secret' };
test('Preview/Beta/Stable 的身份独立，签名通道不能降为无签名且密钥不进入配置', () => {
  const preview = releasePolicy('preview', '0.6.0-beta.1', 'fixture');
  const beta = releasePolicy('signed-beta', '0.6.0-beta.1', 'fixture', environment);
  const stable = releasePolicy('signed-stable', '0.6.0', 'fixture', environment);
  assert.equal(new Set([preview.appId, beta.appId, stable.appId]).size, 3);
  for (const policy of [preview, beta, stable]) assert.deepEqual(parseDistribution(policy.manifest), policy.manifest);
  assert(preview.manifest.profile.startsWith('g06-preview-')); assert.equal(beta.manifest.profile, 'beta'); assert.equal(stable.manifest.profile, 'default');
  assert(beta.signing.forceCodeSigning && stable.signing.win.verifyUpdateCodeSignature); assert(!JSON.stringify(beta).includes(environment.AZURE_CLIENT_SECRET));
  assert.throws(() => releasePolicy('signed-beta', '0.6.0-beta.1', 'fixture'), /SIGNING_NOT_CONFIGURED/);
  assert.throws(() => releasePolicy('signed-stable', '0.6.0-beta.1', 'fixture', environment), /CHANNEL/);
  assert.throws(() => releasePolicy('preview', '0.6.0', 'fixture'), /CHANNEL/);
});
test('篡改发行配置、跨通道数据目录或额外更新 URL 均拒绝', () => {
  const { manifest } = releasePolicy('signed-stable', '0.6.0', 'fixture', environment);
  for (const change of [{ signatureRequired: false }, { profile: 'beta' }, { publisherName: '' }, { repository: 'other/repo' }, { url: 'http://example.test/' }]) assert.throws(() => parseDistribution({ ...manifest, ...change }));
});
test('正式 stable 业务策略拒绝 beta，同版及降级；更高稳定版才可用', async () => {
  let candidate = '0.7.0-beta.1'; let state = emptyUpdateState();
  const service = new UpdateService({ version: '0.6.0', channel: 'stable', unsignedTestDistribution: false, now: Date.now, newId: randomUUID, digest: value => value, store: { async load() { return state; }, async save(value) { state = value; } }, backend: { supported: () => true, async check() { return { version: candidate, fileName: 'fixture.exe', sha512: 'fixture', size: 1 }; }, async download() { throw new Error('不应下载'); }, async verify() {}, cancel() {} }, lifecycle: { async prepare() {}, async install() { throw new Error('不应安装'); } } });
  await service.start();
  for (candidate of ['0.7.0-beta.1', '0.6.0', '0.5.9']) await assert.rejects(service.check(), error => error.code === 'UPDATE_VERSION_REJECTED');
  candidate = '0.6.1'; assert.equal((await service.check()).candidate.version, '0.6.1'); assert.equal(service.status().unsignedTestDistribution, false); await service.close();
});
test('真实 Windows 签名门禁拒绝无签名文件，即使大小与 SHA-512 全部匹配也不派发', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-dog-g06-signature-')); const path = join(directory, 'Codex-Dog-0.6.1-Setup.exe'); const data = Buffer.from('unsigned fixture'); await writeFile(path, data);
  const backend = new WindowsUpdateBackend({ packaged: true, testDistribution: false, directory, executable: join(directory, 'CodexDog.exe'), release: { channel: 'stable', publisherName: '测试发布者', signatureScript: resolve('build/verify-signature.ps1') } }); let dispatched = false;
  await assert.rejects(backend.launchInstaller({ id: randomUUID(), path, version: '0.6.1', size: data.length, sha512: createHash('sha512').update(data).digest('base64') }, () => { dispatched = true; }), error => error.code === 'UPDATE_SIGNATURE_INVALID'); assert.equal(dispatched, false);
  assert.equal(exitCode(failure('UPDATE_SIGNATURE_INVALID', '签名拒绝')), 5);
});
