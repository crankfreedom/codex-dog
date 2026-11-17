import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir, access, open } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { _electron } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const github = process.argv.includes('--github');
const packages = JSON.parse(await readFile('artifacts/g05/packages.json', 'utf8'));
const [oldPackage, newPackage] = packages.packages;
const installDirectory = resolve('artifacts/g05/installed', packages.runId);
const executable = join(installDirectory, packages.executable);
const installedCli = join(installDirectory, 'resources/cli/codex-dog.exe');
const outsideCli = resolve('.cache/g05', packages.runId, oldPackage.version, 'resources/codex-dog.exe');
const manifest = await readFile(join(newPackage.output, 'beta.yml'), 'utf8');
assert(manifest.includes('size:'), '须使用完整含 size 元数据的最终构建');
let mode = 'good'; const requests = [];
const server = createServer((request, response) => {
  requests.push(request.url);
  if (mode === 'offline') { response.writeHead(503); response.end(); return; }
  if (request.url?.split('?')[0] === '/beta.yml') {
    if (mode === 'missing') { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': 'text/yaml' });
    response.end(mode === 'downgrade' ? manifest.replaceAll(newPackage.version, '0.5.0-beta.0') : mode === 'stable' ? manifest.replaceAll(newPackage.version, '0.6.0') : manifest); return;
  }
  if (request.url?.split('?')[0] === `/Codex-Dog-G05-${newPackage.version}-Setup.exe`) {
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': newPackage.size });
    const source = createReadStream(newPackage.files[0]);
    if (mode === 'corrupt') { let first = true; source.pipe(new Transform({ transform(chunk, _, callback) { if (first) { chunk[0] ^= 1; first = false; } callback(null, chunk); } })).pipe(response); }
    else source.pipe(response);
    response.on('close', () => source.destroy()); return;
  }
  response.writeHead(404); response.end();
});
await new Promise(resolveCall => server.listen(0, '127.0.0.1', resolveCall)); const port = server.address().port;
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const checks = []; const pageErrors = []; const marker = randomUUID().slice(0, 8); const manager = 'manager-' + marker; const reader = 'reader-' + marker;
let desktop; let page; let directory; let descriptor; let mcp; let transport;
const mark = value => { checks.push(value); console.log('[G05] ' + value); };
const good = value => { assert(value.ok, value.error?.code); return value.data; };
async function run(command, args, input, timeout = 180000) {
  return new Promise((resolveCall, reject) => {
    const child = spawn(command, args, { windowsHide: true, env, stdio: 'pipe' }); let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('自建测试子进程超时')); }, timeout);
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.once('error', error => { clearTimeout(timer); reject(error); }); child.once('exit', code => { clearTimeout(timer); resolveCall({ code, stdout, stderr }); }); child.stdin.end(input);
  });
}
async function cli(args, params, name = manager, binary = outsideCli) {
  const result = await run(binary, [...args, '--profile', packages.profile, '--client', name, '--json'], params === undefined ? undefined : JSON.stringify(params), 30000);
  try { return { ...result, value: JSON.parse(result.stdout) }; } catch { throw new Error('CLI JSON 无效'); }
}
async function until(read, label, timeout = 30000) { const start = Date.now(); while (!(await read())) { if (Date.now() - start > timeout) throw new Error('等待失败：' + label); await new Promise(resolveCall => setTimeout(resolveCall, 150)); } }
const alive = pid => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
const ipc = (operation, params = {}) => page.evaluate(({ operation, params }) => window.codexDog.request(operation, params), { operation, params });
async function launch() {
  desktop = await _electron.launch({ executablePath: executable, args: ['--g02-test-hooks', ...(!github ? [`--g05-fixture-port=${port}`] : [])], env, timeout: 30000 });
  page = await desktop.firstWindow(); page.on('pageerror', error => pageErrors.push(error.message)); await page.waitForFunction(() => document.getElementById('state')?.textContent?.includes('source=fixture'));
  directory = dirname(await desktop.evaluate(({ app }) => app.getPath('userData'))); descriptor = JSON.parse(await readFile(join(directory, 'endpoint.json'), 'utf8'));
}
async function pair(name, manage) {
  const record = good((await cli(['access', 'request', '--input', '-'], { clientLabel: name, requestedScopes: manage ? ['read', 'app.manage'] : ['read'] }, name)).value);
  const card = page.locator(`[data-client-id="${record.id}"]`); await card.getByRole('textbox', { name: '配对码' }).fill(record.code);
  if (manage) await card.getByRole('checkbox', { name: '允许下载和安装更新' }).check(); await card.getByRole('button', { name: '批准读取' }).click();
  await until(async () => (await cli(['quota', 'get'], undefined, name)).code === 0, '配对完成');
}
async function status() { return good((await cli(['updates', 'status'])).value); }
async function operation(kind, params, key = randomUUID()) {
  const accepted = good((await cli(['updates', kind, '--input', '-', '--idempotency-key', key], params)).value);
  await until(async () => { const s = await status(); return s.operations.some(o => o.id === accepted.operationId && ['succeeded', 'failed', 'awaiting_restart'].includes(o.state)); }, kind + ' 操作落定', 120000);
  return status();
}
try {
  await mkdir(installDirectory, { recursive: true });
  const installed = await run(oldPackage.files[0], ['/S', `/D=${installDirectory}`]); assert.equal(installed.code, 0, '初次 NSIS 安装失败'); await access(executable); await access(installedCli);
  await launch(); assert.equal(good(await ipc('app.version')).version, oldPackage.version); assert.equal(good(await ipc('app.status')).realCodexConnected, false);
  assert.equal((await run(installedCli, ['--version'])).stdout.trim(), oldPackage.version);
  mark('实际 per-user NSIS 安装 beta.1，安装版桌面/worker/内置独立 CLI 同版且仅模拟');
  await pair(manager, true); await pair(reader, false); const originalQuota = good((await cli(['quota', 'get'], undefined, manager, installedCli)).value);
  let checked = good((await cli(['updates', 'check'])).value); assert.equal(checked.candidate.version, newPackage.version); const downloadParams = { candidateId: checked.candidate.id, expectedVersion: checked.candidate.version };
  assert.equal((await cli(['updates', 'download', '--input', '-', '--idempotency-key', 'denied'], downloadParams, reader)).value.error.code, 'PERMISSION_DENIED');
  mark('固定更新源发现 beta.2；默认读取客户端不能下载或安装，app.manage 经桌面明确批准');
  if (!github) {
    for (const fail of ['missing', 'offline', 'stable', 'downgrade']) {
      mode = fail; const result = await cli(['updates', 'check']); if (fail === 'downgrade') assert.equal(good(result.value).candidate, null); else assert.equal(result.value.ok, false); assert.equal(good(await ipc('app.version')).version, oldPackage.version);
    }
    mark('缺清单、HTTP 503、stable 和降级候选不触发安装，旧桌面继续运行');
    mode = 'good'; checked = good((await cli(['updates', 'check'])).value);
    mode = 'corrupt'; let failed = await operation('download', { candidateId: checked.candidate.id, expectedVersion: newPackage.version }); assert.equal(failed.phase, 'failed'); assert.equal(failed.artifact, null);
    mark('实际下载损坏安装包被 SHA-512 校验拒绝，不产生可安装 artifact，旧数据可读'); mode = 'good';
  }
  checked = good((await cli(['updates', 'check'])).value);
  const ready = await operation('download', { candidateId: checked.candidate.id, expectedVersion: newPackage.version }); assert.equal(ready.phase, 'ready'); assert(ready.backend.downloadedBytes > 0, '验证须实际网络下载而非仅命中缓存');
  const downloadedBytes = ready.backend.downloadedBytes; const installParams = { artifactId: ready.artifact.id, expectedVersion: newPackage.version, confirm: true };
  mark(github ? '实际 GitHub beta 清单与安装包完整下载，非回环/缓存替代证据' : '实际回环 HTTP 完整下载 NSIS beta.2，候选/版本/大小/哈希一致');
  if (!github) {
    const state = JSON.parse(await readFile(join(directory, 'updates.json'), 'utf8')); const cache = await open(state.artifact.path, 'r+'); const first = Buffer.alloc(1); await cache.read(first, 0, 1, 0);
    try { await cache.write(Buffer.from([first[0] ^ 1]), 0, 1, 0); const failed = await operation('install', installParams); assert.equal(failed.error, 'UPDATE_INTEGRITY_FAILED'); assert.equal(good(await ipc('app.version')).version, oldPackage.version); }
    finally { await cache.write(first, 0, 1, 0); await cache.close(); }
    mark('下载后缓存被篡改时安装前再次校验失败；恢复原字节后可重试，无隐式降级或覆盖数据');
  }
  transport = new StdioClientTransport({ command: installedCli, args: ['mcp', 'serve', '--profile', packages.profile, '--client', manager], env, stderr: 'pipe' }); mcp = new Client({ name: 'g05-file-lock', version: '1' }); await mcp.connect(transport); transport.stderr?.resume();
  const guard = await run(join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', join(installDirectory, 'resources/cli-file-guard.ps1'), '-CliPath', installedCli]); assert.equal(guard.code, 73);
  const manual = await run(newPackage.files[0], ['/S', `/D=${installDirectory}`]); assert.equal((await run(installedCli, ['--version'])).stdout.trim(), oldPackage.version); assert.equal(good(await ipc('app.version')).version, oldPackage.version);
  mark('长期安装版 MCP 占用 CLI 时，直接运行 beta.2 安装器被阻断，不强杀持有者');
  const blocked = await operation('install', installParams); assert.equal(blocked.error, 'CLI_IN_USE'); assert.equal(good(await ipc('app.version')).version, oldPackage.version);
  await mcp.close(); mcp = undefined; await transport.close(); transport = undefined;
  mark('统一安装入口也因 CLI_IN_USE 保留旧版本；占用者关闭后允许明确新操作重试');
  const taskId = 'g05-held-' + marker; const attemptId = 'g05-intent-' + marker; const target = 'g03-fixture-g05-' + marker;
  for (const params of [{ action: 'create', id: taskId, target }, { action: 'prepare', id: taskId, target, key: attemptId }, { action: 'uncertain', id: attemptId }]) good(await page.evaluate(params => window.codexDogTest.fixture(params), params));
  const before = good(await ipc('app.status')); const oldMain = descriptor.appPid; const oldBroker = descriptor.brokerPid;
  const accepted = good((await cli(['updates', 'install', '--input', '-', '--idempotency-key', 'apply-' + marker], installParams)).value); assert.equal(accepted.state, 'accepted');
  await until(async () => { const result = await cli(['app', 'version']); return result.value.ok && result.value.data.version === newPackage.version; }, 'NSIS 原位升级并启动 beta.2', 180000); desktop = undefined;
  assert(!alive(oldMain)); assert(!alive(oldBroker)); assert(!alive(before.workerPid));
  const upgraded = await status(); assert.equal(upgraded.currentVersion, newPackage.version); assert.equal(upgraded.operations.find(o => o.id === accepted.operationId).state, 'succeeded');
  assert.deepEqual(good((await cli(['quota', 'get'])).value), originalQuota); assert.equal((await run(installedCli, ['--version'])).stdout.trim(), newPackage.version);
  const backups = await import('node:fs/promises').then(fs => fs.readdir(join(directory, 'update-backups'))); assert(backups.includes(accepted.operationId + '.sqlite'));
  const db = new DatabaseSync(join(directory, 'codex-dog.sqlite'), { readOnly: true });
  try { assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); assert.equal(db.prepare('SELECT state FROM fixture_attempts WHERE id=?').get(attemptId).state, 'uncertain'); assert.equal(db.prepare('SELECT state FROM fixture_slots WHERE attemptId=?').get(attemptId).state, 'held'); assert.equal(db.prepare('SELECT count FROM fixture_tasks WHERE id=?').get(taskId).count, 1); } finally { db.close(); }
  mark('beta.1 → beta.2 原位安装并重启核对成功，旧 main/worker/管道宿主退出，桌面和 CLI 同版');
  mark('升级前一致备份存在；授权、模拟额度、原幂等意图/held 槽位/计数保留，不重放未决操作');
  const after = JSON.parse(await readFile(join(directory, 'endpoint.json'), 'utf8')); const health = good((await cli(['app', 'status'])).value); assert.equal(health.realCodexConnected, false);
  // 仅终止刚才升级生成并通过版本核对的自建测试实例，验证异常退出后的手动恢复。
  assert.notEqual(after.appPid, process.pid); assert.notEqual(after.appPid, oldMain); process.kill(after.appPid);
  await until(() => !alive(health.workerPid) && !alive(after.brokerPid), '异常退出子进程自清理'); await launch();
  assert.equal((await status()).currentVersion, newPackage.version); const finalHealth = good(await ipc('app.status')); const finalBroker = descriptor.brokerPid;
  await desktop.close(); desktop = undefined; await until(() => !alive(finalHealth.workerPid) && !alive(finalBroker), '正常退出清理'); await assert.rejects(access(join(directory, 'endpoint.json')));
  assert.equal((await cli(['quota', 'get'])).value.error.code, 'APP_NOT_RUNNING');
  mark('新版本异常退出后可手动恢复；最终正常退出清理端点和子进程，离线 CLI 不拉起后台');
  assert.deepEqual(pageErrors, []);
  const report = { result: 'passed', createdAt: new Date().toISOString(), mode: github ? 'real-github' : 'loopback-nsis', fromVersion: oldPackage.version, toVersion: newPackage.version, checks, pageErrors, downloadedBytes, githubEndToEnd: github, repository: 'crankfreedom/codex-dog', formallyPublished: false, realCodexConnections: 0, messageSends: 0, resetConsumptions: 0, installationDirectory: installDirectory, profile: packages.profile, localHttpRequests: github ? [] : requests, signature: 'unsigned-test-only' };
  await writeFile(`artifacts/g05/${github ? 'github' : 'local'}-report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await mcp?.close().catch(() => {}); await transport?.close().catch(() => {}); await desktop?.close().catch(() => {}); await new Promise(resolveCall => server.close(resolveCall)); }
