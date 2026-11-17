import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, access, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import electron from 'electron';
import { launchSmokeHost } from './electron-smoke-host.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const stage = version.match(/-(g\d+)$/)[1];
const reportDirectory = stage === 'g03' ? 'artifacts/g03' : `artifacts/${stage}/g03-regression`;
const executable = resolve(`release/${stage}/codex-dog.exe`);
const profile = `g03-smoke-${randomUUID().slice(0, 8)}`;
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const checks = []; const pageErrors = []; let desktop; let page; let directory; let descriptor; let client; let transport; let runtime;
const mark = value => { checks.push(value); console.log(`[G03] ${value}`); };
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
async function until(check, label, timeout = 20000) {
  const start = Date.now(); while (!(await check())) { if (Date.now() - start > timeout) throw new Error('等待失败：' + label); await new Promise(resolveCall => setTimeout(resolveCall, 50)); }
}
async function run(command, args, input, runEnv = env) {
  return new Promise((resolveCall, reject) => {
    const child = spawn(command, args, { env: runEnv, windowsHide: true, stdio: 'pipe' }); let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('测试子进程超时')); }, 30000);
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); resolveCall({ code, stdout, stderr }); }); child.stdin.end(input);
  });
}
async function cli(args) {
  const result = await run(executable, [...args, '--profile', profile, '--client', 'reader', '--json'], undefined, { ...env, PATH: '', NODE_OPTIONS: '' });
  return { ...result, value: JSON.parse(result.stdout) };
}
const ipc = (operation, params = {}) => page.evaluate(({ operation, params }) => window.codexDog.request(operation, params), { operation, params });
const fixture = params => page.evaluate(params => window.codexDogTest.fixture(params), params);
async function successful(params) { const result = await fixture(params); assert(result.ok, JSON.stringify(result)); return result.data; }
async function launch(hooks = true) {
  ({ desktop, page } = await launchSmokeHost({ executablePath: electron, args: ['.', `--profile=${profile}`, '--fixture=available', ...(hooks ? ['--g02-test-hooks'] : [])], env, timeout: 30000 }, 'g03')); page.on('pageerror', error => pageErrors.push(error.message));
  await page.waitForFunction(() => document.getElementById('state')?.textContent?.includes('source=fixture'));
  directory = dirname(await desktop.evaluate(({ app }) => app.getPath('userData')));
  descriptor = JSON.parse(await readFile(join(directory, 'endpoint.json'), 'utf8'));
}
async function closeHost() {
  const state = await ipc('app.status'); const pid = state.data.workerPid; const broker = descriptor.brokerPid;
  await desktop.close(); desktop = undefined;
  await until(() => !alive(pid) && !alive(broker), '关闭数据库与子进程');
  await assert.rejects(access(join(directory, 'endpoint.json')));
}
async function recovered(oldPid) {
  await until(async () => { const state = await ipc('app.status'); return state.ok && state.data.state === 'running' && state.data.workerPid !== oldPid; }, 'worker 恢复');
  assert(!alive(oldPid));
}
try {
  assert.equal((await cli(['quota', 'get'])).code, 5);
  await launch(); runtime = await successful({ action: 'health' });
  assert.equal(runtime.schemaVersion, 3); assert.equal(runtime.journalMode, 'wal'); assert.equal(runtime.integrity, 'ok');
  mark('实际 Electron utilityProcess 内置 node:sqlite 可用，Schema 3、WAL 和完整性检查通过');
  const registration = await cli(['access', 'request']); assert(registration.value.ok);
  const record = registration.value.data; const card = page.locator(`[data-client-id="${record.id}"]`);
  await page.getByRole('button', { name: '客户端授权', exact: true }).click();
  await card.getByRole('textbox', { name: '配对码' }).fill(record.code); await card.getByRole('button', { name: '批准读取' }).click();
  await until(async () => (await cli(['quota', 'get'])).code === 0, '批准读权限');
  const first = (await cli(['quota', 'get'])).value;
  assert.deepEqual(first.data, (await ipc('quota.get')).data);
  transport = new StdioClientTransport({ command: executable, args: ['mcp', 'serve', '--profile', profile, '--client', 'reader'], env: { ...env, PATH: '', NODE_OPTIONS: '' }, stderr: 'pipe' });
  client = new Client({ name: 'g03-validation', version: '1' }); await client.connect(transport); transport.stderr?.resume();
  const mcp = await client.callTool({ name: 'quota_get', arguments: {} }); assert.deepEqual(mcp.structuredContent.data, first.data); assert.equal(mcp.structuredContent.meta.handlerInstanceId, first.meta.handlerInstanceId);
  assert.equal((await client.listTools()).tools.length, 42);
  mark('配对后独立 EXE、IPC 与官方 MCP 客户端共用 SQLite 初始化的同一额度快照和处理器');
  assert.equal((await ipc('g03.test')).error.code, 'CAPABILITY_UNSUPPORTED');
  mark('G03 事务探针未注册公开能力目录，普通业务入口不能调用');

  await successful({ action: 'create', id: 'rollback', target: 'g03-fixture-rollback' });
  const before = await successful({ action: 'snapshot' });
  assert.equal((await fixture({ action: 'prepare', id: 'rollback', target: 'g03-fixture-rollback', key: 'fail', fault: 'throw' })).ok, false);
  assert.deepEqual(await successful({ action: 'snapshot' }), before);
  mark('真实 worker 中事务中途异常令意图、槽位、计数、关键事件和幂等结果整体回滚');
  let state = await ipc('app.status');
  assert.equal((await fixture({ action: 'prepare', id: 'rollback', target: 'g03-fixture-rollback', key: 'crash-uncommitted', fault: 'crash' })).error.code, 'APP_NOT_READY');
  await recovered(state.data.workerPid); assert.deepEqual(await successful({ action: 'snapshot' }), before);
  assert.deepEqual((await ipc('quota.get')).data, first.data);
  mark('未提交事务期间直接退出 worker，恢复后 SQLite 回滚全部修改，额度原始快照未重建');
  const staleLocks = await readdir(join(directory, 'fixture-target-locks')); assert.equal(staleLocks.length, 1);
  assert.equal((await fixture({ action: 'prepare', id: 'rollback', target: 'g03-fixture-rollback', key: 'no-steal' })).error.code, 'TARGET_BUSY');
  mark('异常退出的模拟目标锁保留并阻断重入，不根据 PID 失效自动抢锁');

  await successful({ action: 'create', id: 'committed', target: 'g03-fixture-committed' }); state = await ipc('app.status');
  assert.equal((await fixture({ action: 'prepare', id: 'committed', target: 'g03-fixture-committed', key: 'committed-before-ack', fault: 'crash_after_commit' })).error.code, 'APP_NOT_READY');
  await recovered(state.data.workerPid);
  let persisted = await successful({ action: 'snapshot' }); assert.equal(persisted.tasks.find(t => t.id === 'committed').count, 1); assert.equal(persisted.operations, 1); assert.equal(persisted.slots.filter(s => s.state === 'held').length, 1);
  const replay = await successful({ action: 'replay', id: 'committed', key: 'committed-before-ack' }); assert.equal(replay.count, 1); assert.deepEqual(await successful({ action: 'snapshot' }), persisted);
  mark('提交后响应前直接退出 worker，恢复保留完整事务，原键回放不新增意图、计数或事件');
  await successful({ action: 'uncertain', id: 'committed-before-ack' }); assert.equal((await fixture({ action: 'cancel', id: 'committed-before-ack' })).error.code, 'UNRESOLVED_ATTEMPT');
  persisted = await successful({ action: 'snapshot' });
  mark('不确定意图保留 held 槽位及计数，不能按确定未写入路径回退');
  await successful({ action: 'backup' });
  const backup = new DatabaseSync(join(directory, 'fixture-backup.sqlite'), { readOnly: true });
  try { assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); assert.equal(backup.prepare('SELECT count FROM fixture_tasks WHERE id=?').get('committed').count, 1); assert.equal(backup.prepare('SELECT state FROM fixture_attempts WHERE id=?').get('committed-before-ack').state, 'uncertain'); } finally { backup.close(); }
  mark('运行中通过 VACUUM INTO 备份 WAL 已提交数据，备份独立打开完整且保留未决状态');

  await client.close(); client = undefined; await transport.close(); transport = undefined;
  await closeHost();
  const database = new DatabaseSync(join(directory, 'codex-dog.sqlite'), { readOnly: true });
  try { assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); assert.equal(database.prepare('SELECT count(*) n FROM observations').get().n, 1); } finally { database.close(); }
  await launch(); assert.deepEqual((await cli(['quota', 'get'])).value.data, first.data); assert.deepEqual(await successful({ action: 'snapshot' }), persisted);
  mark('完全退出后数据库可独立只读检查，手动重启保留授权、额度、计数、幂等与未决状态');
  await closeHost(); await launch(false);
  assert.equal(await page.evaluate(() => typeof window.codexDogTest), 'undefined'); assert.equal((await cli(['quota', 'get'])).code, 0);
  mark('正常启动不暴露测试 bridge，持久化读取仍可经已授权 CLI 使用');
  await closeHost();
  const future = new DatabaseSync(join(directory, 'codex-dog.sqlite')); future.exec('PRAGMA user_version=99'); future.close();
  const original = await readFile(join(directory, 'codex-dog.sqlite'));
  await run(electron, ['.', `--profile=${profile}`, '--fixture=available']);
  await assert.rejects(access(join(directory, 'endpoint.json'))); assert.deepEqual(await readFile(join(directory, 'codex-dog.sqlite')), original);
  mark('隔离数据库改为未来版本后实际主应用拒绝开放服务，不覆盖数据库或发布端点');
  assert.deepEqual(pageErrors, []);
  await mkdir(reportDirectory, { recursive: true });
  const report = { result: 'passed', createdAt: new Date().toISOString(), version, apiVersion: '3', dataSource: 'fixture', runtime, nodeTestRuntime: process.versions.node, checks, pageErrors, realCodexConnections: 0, scope: `G03 regression under ${version}; other gates evaluated separately`, legacyLockEvidence: '原始 FileJournal 仅在旧源码可用时由 target-lease 单元测试验证；须检查其 TAP 是否跳过，本脚本不证明旧源码互操作', automaticStaleLockReclaim: false };
  await writeFile(`${reportDirectory}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await client?.close().catch(() => {}); await transport?.close().catch(() => {}); await desktop?.close().catch(() => {}); }
