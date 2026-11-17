import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { connect, createServer } from 'node:net';
import electron from 'electron';
import { launchSmokeHost } from './electron-smoke-host.mjs';
import { windowsPowerShellEnvironment, isWindowsPowerShell } from '../packages/infrastructure/windows-powershell.ts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const baselineOnly = process.argv.includes('--g01-only');
const profile = `g02-smoke-${randomUUID().slice(0, 8)}`;
const { version: appVersion } = JSON.parse(await readFile('package.json', 'utf8'));
const stage = appVersion.match(/-(g\d+)$/)[1];
const reportDirectory = stage === 'g02' ? 'artifacts/g02' : `artifacts/${stage}/g02-regression`;
const executable = resolve(`release/${stage}/codex-dog.exe`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const executableEnv = { ...env, PATH: '', NODE_OPTIONS: '' };
const checks = []; const pageErrors = []; const ownedSockets = new Set();
const mark = value => { checks.push(value); console.log(`[G02] ${value}`); };
let desktop; let page; let client; let mcpTransport; let descriptor; let profileDirectory;
async function until(check, label, timeout = 15000) {
  const started = Date.now();
  while (!(await check())) { if (Date.now() - started > timeout) throw new Error(`等待失败：${label}`); await new Promise(resolveCall => setTimeout(resolveCall, 30)); }
}
async function run(command, args, options = {}) {
  return new Promise((resolveCall, reject) => {
    const environment = options.env ?? env;
    const child = spawn(command, args, { env: isWindowsPowerShell(command) ? windowsPowerShellEnvironment(environment) : environment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('子进程超时')); }, options.timeout ?? 20000);
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); resolveCall({ code, stdout, stderr }); });
    child.stdin.end(options.stdin);
  });
}
async function cli(args, name = 'reader', input) {
  const result = await run(executable, [...args, '--profile', profile, '--client', name, '--json'], { env: executableEnv, stdin: input === undefined ? undefined : JSON.stringify(input) });
  try { return { ...result, value: JSON.parse(result.stdout) }; } catch { throw new Error(`CLI 输出不是 JSON：${result.stdout}\n${result.stderr}`); }
}
async function launch() {
  ({ desktop, page } = await launchSmokeHost({ executablePath: electron, args: ['.', `--profile=${profile}`, '--fixture=available', '--g02-test-hooks', '--test-delay-ms=800'], env, timeout: 30000 }, 'g02')); page.on('pageerror', error => pageErrors.push(error.message));
  await page.waitForFunction(() => document.getElementById('state')?.textContent?.includes('source=fixture'));
  profileDirectory = dirname(await desktop.evaluate(({ app }) => app.getPath('userData')));
  descriptor = JSON.parse(await readFile(join(profileDirectory, 'endpoint.json'), 'utf8'));
}
async function ipc(operation, params = {}, key) { return page.evaluate(({ operation, params, key }) => window.codexDog.request(operation, params, key), { operation, params, key }); }
async function approve(record, admin = false) {
  await page.getByRole('button', { name: '客户端授权', exact: true }).click();
  const card = page.locator(`[data-client-id="${record.id}"]`);
  await card.getByRole('textbox', { name: '配对码' }).fill(record.code);
  if (admin) await card.getByRole('checkbox', { name: '允许管理客户端授权' }).check();
  await card.getByRole('button', { name: '批准读取' }).click();
  await until(async () => { const list = await ipc('access.list'); return list.ok && list.data.clients.some(item => item.id === record.id && item.status === 'granted'); }, '桌面批准配对');
}
function seal(value, binding) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', Buffer.from(descriptor.transportKey, 'hex'), iv); cipher.setAAD(Buffer.from(binding));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { iv: iv.toString('hex'), ciphertext: bytes.toString('base64'), tag: cipher.getAuthTag().toString('hex') };
}
function unseal(packet, binding) {
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(descriptor.transportKey, 'hex'), Buffer.from(packet.iv, 'hex')); decipher.setAAD(Buffer.from(binding)); decipher.setAuthTag(Buffer.from(packet.tag, 'hex'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(packet.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
}
async function raw(value, malformed = false, oversize = false) {
  return new Promise((resolveCall, reject) => {
    const packet = seal(value, descriptor.instanceId + ':client');
    const socket = connect(descriptor.pipe); let buffer = Buffer.alloc(0); ownedSockets.add(socket);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('管道请求超时')); }, 15000);
    socket.on('error', error => { clearTimeout(timer); reject(error); });
    socket.on('end', () => { if (buffer.length < 4) { clearTimeout(timer); reject(new Error('管道在返回帧前关闭')); } });
    socket.once('connect', () => { const payload = oversize ? Buffer.alloc(0) : Buffer.from(malformed ? '{bad-json' : JSON.stringify(packet)); const header = Buffer.alloc(4); header.writeUInt32LE(oversize ? 1024 * 1024 + 1 : payload.length); socket.write(Buffer.concat([header, payload])); });
    socket.on('data', chunk => { buffer = Buffer.concat([buffer, chunk]); if (buffer.length >= 4 && buffer.length === buffer.readUInt32LE(0) + 4) { clearTimeout(timer); socket.destroy(); ownedSockets.delete(socket); const reply = JSON.parse(buffer.subarray(4).toString('utf8')); resolveCall(malformed || oversize ? reply : unseal(reply, descriptor.instanceId + ':server:' + packet.iv)); } });
  });
}
async function nativeProbe(mode) {
  const result = await run(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', resolve('out/windows-pipe.ps1'), '-Mode', mode, '-PipeName', descriptor.pipe.split('\\').at(-1), '-Directory', profileDirectory]);
  assert.equal(result.code, 0, result.stderr); return JSON.parse(result.stdout.trim());
}
function alive(pid) { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } }
async function closeHost() {
  const health = await ipc('app.status'); const workerPid = health.ok ? health.data.workerPid : null;
  const brokerPid = descriptor.brokerPid;
  await desktop.close(); desktop = undefined;
  await until(() => !alive(workerPid) && !alive(brokerPid), '退出清理 worker 与安全管道宿主');
  await assert.rejects(access(join(profileDirectory, 'endpoint.json')));
}
try {
  const offline = await cli(['quota', 'get']); assert.equal(offline.code, 5); mark('PATH 为空的独立 EXE 离线返回 5，不自动启动主应用');
  await launch();
  assert.equal(descriptor.apiVersion, '3'); assert(!('token' in descriptor));
  const beforePair = await cli(['quota', 'get']); assert.equal(beforePair.code, 3); assert.equal(beforePair.value.error.code, 'AUTH_REQUIRED');
  mark('应用启动仍须客户端配对，端点不再携带共享授权 token');
  const acl = await nativeProbe('Inspect');
  assert.equal(acl.ownerSid, descriptor.ownerSid); assert.equal(acl.rootProtected, true);
  const allow = [...acl.pipeSddl.matchAll(/\(A;[^)]*\)/g)].map(match => match[0]);
  assert.equal(allow.length, 1); assert.equal(acl.pipeAclVerified, true); assert(/\(D;[^)]*;;;NU\)/.test(acl.pipeSddl));
  assert.equal(acl.rootAclVerified, true);
  assert.equal([...acl.rootSddl.matchAll(/\(A;[^)]*\)/g)].length, 1);
  const anonymous = await nativeProbe('AnonymousProbe'); assert.equal(anonymous.denied, true); assert.equal(anonymous.error, 5);
  mark('实际管道 DACL 仅允许当前 SID、拒绝网络登录；匿名模拟身份实际连接被拒绝');
  const squatProfile = 'g02-squat-' + randomUUID().slice(0, 8);
  const squatPipe = descriptor.pipe.slice(0, -profile.length) + squatProfile;
  const squatServer = createServer(socket => socket.destroy());
  await new Promise((resolveCall, reject) => { squatServer.once('error', reject); squatServer.listen(squatPipe, resolveCall); });
  try {
    const attempt = await run(electron, ['.', `--profile=${squatProfile}`, '--fixture=available']);
    assert([0, 1].includes(attempt.code));
    await assert.rejects(access(join(dirname(profileDirectory), squatProfile, 'endpoint.json')));
  } finally { await new Promise(resolveCall => squatServer.close(resolveCall)); }
  mark('同名管道被预先占用时拒绝启动本机服务，不加入已有实例或发布端点');
  const request = { apiVersion: '3', requestId: 'raw-read', operation: 'quota.get', params: {} };
  const noAuth = await raw({ request }); assert.equal(noAuth.error.code, 'AUTH_REQUIRED');
  const wrong = await raw({ request, credential: { clientId: randomUUID(), secret: '0'.repeat(64) } }); assert.equal(wrong.error.code, 'PERMISSION_DENIED');
  const forged = await raw({ request, scopes: ['access.manage'], peerSid: descriptor.ownerSid }); assert.equal(forged.error.code, 'INVALID_ARGUMENT');
  const invalidJson = await raw({}, true); assert.equal(invalidJson.error.code, 'INVALID_ARGUMENT');
  const oversized = await raw({}, false, true); assert.equal(oversized.error.code, 'INPUT_TOO_LARGE');
  assert((await ipc('quota.get')).ok); mark('缺失/伪造凭据、伪造身份字段、无效 JSON 和超大帧拒绝且不关闭服务');
  const pairing = await cli(['access', 'request']); assert.equal(pairing.code, 0); assert.equal(pairing.value.data.status, 'pending');
  const reader = pairing.value.data;
  assert.equal((await cli(['quota', 'get'])).value.error.code, 'AUTH_REQUIRED');
  await approve(reader);
  const ipcQuota = await ipc('quota.get'); assert(ipcQuota.ok);
  const granted = await cli(['quota', 'get']); assert.equal(granted.code, 0); assert.equal(granted.stderr, '');
  assert.deepEqual(granted.value.data, ipcQuota.data); assert.equal(granted.value.meta.handlerInstanceId, ipcQuota.meta.handlerInstanceId);
  assert.equal(granted.value.data.source, 'fixture'); assert.notEqual(granted.value.meta.workerPid, descriptor.appPid);
  mark('桌面核对六位配对码批准后，独立 CLI 与 IPC 共用同一模拟业务处理器');
  const selfGrant = await cli(['access', 'grant', '--input', '-', '--idempotency-key', 'self-grant'], 'reader', { id: reader.id, expectedRevision: 2, code: reader.code, scopes: ['read'], expiresAt: null });
  assert.equal(selfGrant.code, 3); assert.equal(selfGrant.value.error.code, 'PERMISSION_DENIED');
  mark('默认读取授权不能自授或管理其他客户端');
  const adminPair = await cli(['access', 'request', '--input', '-'], 'admin', { clientLabel: 'smoke-admin', requestedScopes: ['read', 'access.manage'] }); assert.equal(adminPair.code, 0);
  await approve(adminPair.value.data, true);
  const list = await cli(['access', 'list'], 'admin'); assert.equal(list.code, 0); assert(!JSON.stringify(list.value).includes('secretHash'));
  const readerCredential = JSON.parse(await readFile(join(profileDirectory, 'clients/reader.json'), 'utf8'));
  const persisted = await readFile(join(profileDirectory, 'access.json'), 'utf8'); assert(!persisted.includes(readerCredential.secret));
  mark('管理权限须桌面明确选择；服务端只保存秘密摘要，对外列表无秘密字段');
  const race = await Promise.all(Array.from({ length: 3 }, () => cli(['access', 'request'], 'race')));
  assert(race.every(item => item.code === 0)); assert.equal(new Set(race.map(item => item.value.data.id)).size, 1);
  const allReads = await Promise.all(Array.from({ length: 17 }, () => cli(['quota', 'get']))); assert(allReads.every(item => item.code === 0 && item.value.meta.workerPid === ipcQuota.meta.workerPid));
  mark('并发申请同一客户端不覆盖凭据、不重复创建；并发读取共用唯一 worker');
  const beforeInstance = descriptor.instanceId;
  const duplicate = await Promise.all(Array.from({ length: 2 }, () => run(electron, ['.', `--profile=${profile}`, '--fixture=available'])));
  assert(duplicate.every(item => item.code === 0));
  const afterDuplicate = JSON.parse(await readFile(join(profileDirectory, 'endpoint.json'), 'utf8'));
  assert.equal(afterDuplicate.instanceId, beforeInstance); assert.equal((await cli(['quota', 'get'])).value.meta.workerPid, ipcQuota.meta.workerPid);
  mark('同 profile 并发启动仅保留原实例，不重写端点或重复 worker');
  mcpTransport = new StdioClientTransport({ command: executable, args: ['mcp', 'serve', '--profile', profile, '--client', 'mcp'], env: executableEnv, stderr: 'pipe' });
  client = new Client({ name: 'g02-validation', version: '1.0.0' }); await client.connect(mcpTransport);
  assert.equal((await client.listTools()).tools.length, 23);
  const unpairedMcp = await client.callTool({ name: 'quota_get', arguments: {} }); assert.equal(unpairedMcp.structuredContent.error.code, 'AUTH_REQUIRED');
  const mcpPair = await client.callTool({ name: 'access_request', arguments: { clientLabel: 'mcp', requestedScopes: ['read'] } }); assert.equal(mcpPair.isError, false); await approve(mcpPair.structuredContent.data);
  const mcpQuota = await client.callTool({ name: 'quota_get', arguments: {} }); assert.deepEqual(mcpQuota.structuredContent.data, ipcQuota.data); assert.equal(mcpQuota.structuredContent.meta.handlerInstanceId, ipcQuota.meta.handlerInstanceId);
  const badMcp = await client.callTool({ name: 'quota_get', arguments: { injected: true } }); assert.equal(badMcp.structuredContent.error.code, 'INVALID_ARGUMENT');
  mark('MCP 通过同一配对和授权入口，业务结果及参数错误与 CLI/IPC 一致');
  const savedReaderId = reader.id; const savedMcpId = mcpPair.structuredContent.data.id;
  await closeHost(); assert.equal((await cli(['quota', 'get'])).code, 5);
  assert.equal((await client.callTool({ name: 'quota_get', arguments: {} })).structuredContent.error.code, 'APP_NOT_RUNNING');
  await launch(); assert.notEqual(descriptor.instanceId, beforeInstance);
  assert.equal((await cli(['quota', 'get'])).code, 0); assert.equal((await client.callTool({ name: 'quota_get', arguments: {} })).isError, false);
  mark('正常退出不留端点或子进程；重启后已批准授权仍有效，MCP 不自动拉起应用');
  const inFlight = cli(['quota', 'get']);
  await until(async () => (await ipc('app.status')).data.inFlight >= 1, '读取进入业务进程');
  const revoke = await ipc('access.revoke', { id: savedReaderId, expectedRevision: 2 }, randomUUID()); assert(revoke.ok);
  const revokedRead = await inFlight; assert.equal(revokedRead.code, 3); assert.equal(revokedRead.value.error.code, 'AUTH_REVOKED');
  assert.equal((await cli(['quota', 'get'])).value.error.code, 'AUTH_REVOKED');
  assert.equal((await cli(['access', 'request'])).value.error.code, 'AUTH_REVOKED');
  const revokeMcp = await cli(['access', 'revoke', '--input', '-', '--idempotency-key', 'revoke-mcp'], 'admin', { id: savedMcpId, expectedRevision: 2 }); assert.equal(revokeMcp.code, 0);
  assert.equal((await client.callTool({ name: 'quota_get', arguments: {} })).structuredContent.error.code, 'AUTH_REVOKED');
  mark('撤销后 CLI/MCP 立即失效；在途慢读取返回前再次复核，不能返回已撤销数据');
  await client.close(); client = undefined; mcpTransport = undefined;
  if (!baselineOnly) {
    let status = await ipc('app.status'); const firstPid = status.data.workerPid;
    await desktop.evaluate(({ app }) => app.emit('dog:test:control', null, 'test:exit'));
    await until(async () => { const s = await ipc('app.status'); return s.ok && s.data.state === 'running' && s.data.restartCount === 1 && s.data.workerPid !== firstPid; }, '崩溃后第一次恢复');
    assert(!alive(firstPid)); assert.equal((await cli(['quota', 'get'], 'admin')).code, 0);
    mark('业务进程崩溃后自动恢复，旧进程结束，授权不丢失');
    await desktop.evaluate(({ app }) => app.emit('dog:test:control', null, 'test:hang'));
    const hung = cli(['quota', 'get'], 'admin');
    await until(async () => { const s = await ipc('app.status'); return s.ok && s.data.state === 'running' && s.data.restartCount === 2; }, '心跳超时恢复');
    assert.equal((await hung).value.error.code, 'APP_NOT_READY');
    mark('心跳超时终止失联 worker，在途请求明确失败，有限恢复后可继续读取');
    await desktop.evaluate(({ app }) => app.emit('dog:test:control', null, 'test:exit'));
    await until(async () => { const s = await ipc('app.status'); return s.ok && s.data.state === 'running' && s.data.restartCount === 3; }, '第三次有限恢复');
    await desktop.evaluate(({ app }) => app.emit('dog:test:control', null, 'test:exit'));
    await until(async () => (await ipc('app.status')).data.state === 'failed', '重启预算耗尽');
    const failed = await ipc('app.status'); assert.equal(failed.data.restartCount, 3); assert.equal(failed.data.reason, 'restart_limit_reached');
    assert.equal((await cli(['quota', 'get'], 'admin')).value.error.code, 'APP_NOT_READY');
    mark('最多重启三次，ready 不重置预算；耗尽后稳定失败，不无限拉起');
    await closeHost(); await launch();
    await desktop.evaluate(({ app }) => app.emit('dog:test:control', null, 'test:exit'));
    await until(async () => (await ipc('app.status')).data.state === 'restarting', '退出前存在已排队重启');
    const idleSocket = connect(descriptor.pipe); idleSocket.on('error', () => {}); ownedSockets.add(idleSocket);
    await closeHost(); idleSocket.destroy(); ownedSockets.delete(idleSocket);
    await new Promise(resolveCall => setTimeout(resolveCall, 700));
    assert.equal((await cli(['quota', 'get'], 'admin')).code, 5);
    mark('退出取消排队重启，空闲连接和管道宿主关闭，退出后不再生成 worker');
    await launch();
    const hardStatus = await ipc('app.status'); const brokerPid = descriptor.brokerPid;
    const actualMainPid = await desktop.evaluate(() => process.pid);
    assert.equal(actualMainPid, descriptor.appPid);
    process.kill(actualMainPid, 'SIGKILL');
    await until(() => !alive(actualMainPid) && !alive(brokerPid) && !alive(hardStatus.data.workerPid), '主应用异常退出后子进程自清理');
    await desktop.close().catch(() => {}); desktop = undefined;
    assert.equal((await cli(['quota', 'get'], 'admin')).code, 5);
    mark('仅终止自建测试主应用时，worker 检测父进程退出、管道宿主检测 EOF 并结束；陈旧端点不能恢复调用');
    let captured = '';
    const forgedServer = createServer(socket => {
      let bytes = Buffer.alloc(0);
      socket.on('error', () => {});
      socket.on('data', chunk => {
        bytes = Buffer.concat([bytes, chunk]);
        if (bytes.length >= 4 && bytes.length >= bytes.readUInt32LE(0) + 4) {
          captured = bytes.subarray(4).toString('utf8');
          const body = Buffer.from(JSON.stringify({ ok: true, data: { forged: true } }));
          const header = Buffer.alloc(4); header.writeUInt32LE(body.length); socket.end(Buffer.concat([header, body]));
        }
      });
    });
    await new Promise((resolveCall, reject) => { forgedServer.once('error', reject); forgedServer.listen(descriptor.pipe, resolveCall); });
    try {
      const forgedReply = await cli(['quota', 'get'], 'admin'); assert.equal(forgedReply.code, 5); assert.equal(forgedReply.value.error.code, 'PROTOCOL_INCOMPATIBLE');
      const adminCredential = JSON.parse(await readFile(join(profileDirectory, 'clients/admin.json'), 'utf8'));
      assert(captured); assert(!captured.includes(adminCredential.secret)); assert.deepEqual(Object.keys(JSON.parse(captured)).sort(), ['ciphertext', 'iv', 'tag']);
    } finally { await new Promise(resolveCall => forgedServer.close(resolveCall)); }
    mark('异常退出后的伪造同名服务只收到密文，未认证的成功响应被拒绝');
    await launch(); assert.equal((await cli(['quota', 'get'], 'admin')).code, 0); assert.equal((await cli(['quota', 'get'])).value.error.code, 'AUTH_REVOKED');
    mark('异常退出后手动重启可恢复，撤销记录持久化且不会复活旧客户端');
  }
  assert.deepEqual(pageErrors, []);
  await mkdir(reportDirectory, { recursive: true }); await page.screenshot({ path: `${reportDirectory}/window.png` });
  await closeHost();
  const report = { result: 'passed', createdAt: new Date().toISOString(), version: appVersion, apiVersion: '3', dataSource: 'fixture', checks, pageErrors,
    identity: { pipeAllowsOnlyCurrentSid: true, networkLogonDeniedByDacl: true, anonymousImpersonationDenied: anonymous.denied, protectedProfileDirectory: acl.rootProtected, firstInstanceProtection: true, authenticatedEncryptedChannel: true, secondWindowsAccountCreated: false },
    permissions: { defaultScopes: ['read'], accessManagementExplicit: true, rawSecretsInServerStore: false, revokedReadBlocked: true }, realCodexConnections: 0, scope: baselineOnly ? 'G01 regression under current authentication' : `G02 regression under ${appVersion}; other gates evaluated separately` };
  await writeFile(`${reportDirectory}/${baselineOnly ? 'g01-regression' : 'report'}.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally {
  for (const socket of ownedSockets) socket.destroy();
  await client?.close().catch(() => {}); await mcpTransport?.close().catch(() => {}); await desktop?.close().catch(() => {});
}
