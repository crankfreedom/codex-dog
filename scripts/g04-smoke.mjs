import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import electron from 'electron';
import { _electron } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const target = process.env.CODEX_THREAD_ID;
assert(target && /^[a-f0-9-]{36}$/i.test(target), '请明确提供 CODEX_THREAD_ID，只验证该现有会话');
const profile = 'g04-read-' + randomUUID().slice(0, 8);
const executable = resolve('release/g04/codex-dog.exe');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let desktop; let page; let directory; let descriptor; let client; let transport;
const checks = []; const pageErrors = []; const mark = value => { checks.push(value); console.log('[G04] ' + value); };
async function until(read, message, timeout = 20000) { const start = Date.now(); while (!(await read())) { if (Date.now() - start > timeout) throw new Error(message); await new Promise(resolveCall => setTimeout(resolveCall, 100)); } }
async function cli(args, input) {
  return new Promise((resolveCall, reject) => {
    const child = spawn(executable, [...args, '--profile', profile, '--client', 'reader', '--json', '--timeout-ms', '45000'], { windowsHide: true, env: { ...env, PATH: '', NODE_OPTIONS: '' }, stdio: 'pipe' }); let stdout = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('只读 CLI 测试超时')); }, 50000);
    child.stdout.on('data', data => { stdout += data; }); child.stderr.resume(); child.on('error', reject);
    child.on('exit', code => { clearTimeout(timer); try { resolveCall({ code, value: JSON.parse(stdout) }); } catch { reject(new Error('只读 CLI 输出无效')); } }); child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
  });
}
const ipc = (operation, params = {}) => page.evaluate(({ operation, params }) => window.codexDog.request(operation, params), { operation, params });
const good = result => { assert(result.ok, result.error?.code); return result.data; };
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
try {
  assert.equal((await cli(['quota', 'get'])).value.error.code, 'APP_NOT_RUNNING');
  desktop = await _electron.launch({ executablePath: electron, args: ['.', `--profile=${profile}`, '--source=live-readonly', `--codex-caller-thread=${target}`], env, timeout: 30000 });
  page = await desktop.firstWindow(); page.on('pageerror', error => pageErrors.push(error.message)); await page.waitForFunction(() => typeof window.codexDog?.request === 'function');
  directory = dirname(await desktop.evaluate(({ app }) => app.getPath('userData'))); descriptor = JSON.parse(await readFile(join(directory, 'endpoint.json'), 'utf8'));
  let connection = good(await ipc('connections.get')); assert.equal(connection.state, 'ready', connection.reason); assert.equal(connection.identityVerified, true);
  assert.equal(descriptor.apiVersion, '3'); assert.equal(await page.evaluate(() => typeof window.codexDogTest), 'undefined');
  mark('实际 Electron 显式启动 live-readonly，真实桌面账号身份可确认，API 3，无测试 bridge');
  const discovered = good(await ipc('connections.discover')); assert(discovered.candidates.some(c => c.selected));
  mark('发现并锁定当前唯一桌面工具管道，不读取索引末行猜选调用者');
  assert.equal((await cli(['quota', 'get'])).value.error.code, 'AUTH_REQUIRED');
  const registration = good((await cli(['access', 'request'])).value); const card = page.locator(`[data-client-id="${registration.id}"]`);
  await card.getByRole('textbox', { name: '配对码' }).fill(registration.code); await card.getByRole('button', { name: '批准读取' }).click();
  await until(async () => (await cli(['quota', 'get'])).code === 0, '等待桌面批准读取');
  const quota = good((await cli(['quota', 'get'])).value); assert.equal(quota.source, 'live'); assert.equal(quota.stale, false); assert.equal(quota.windows.length, 2); assert(!('accountId' in quota));
  assert.deepEqual(good(await ipc('quota.get')), quota);
  transport = new StdioClientTransport({ command: executable, args: ['mcp', 'serve', '--profile', profile, '--client', 'reader', '--timeout-ms', '45000'], env: { ...env, PATH: '', NODE_OPTIONS: '' }, stderr: 'pipe' });
  client = new Client({ name: 'g04-readonly-validation', version: '1' }); await client.connect(transport); transport.stderr?.resume();
  const mcpQuota = await client.callTool({ name: 'quota_get', arguments: {} }); assert.deepEqual(good(mcpQuota.structuredContent), quota);
  mark('配对后的独立 EXE、IPC 和官方 MCP 客户端返回同一真实额度观察，不输出账号或卡片信息');
  const refreshed = good((await cli(['quota', 'refresh'])).value); assert.equal(refreshed.source, 'live'); assert.equal(refreshed.stale, false);
  mark('quota.refresh 重新执行真实只读查询，不消费重置卡或推进任务');
  const listParams = { connectionId: connection.connectionId, limit: 3, archived: false };
  const listed = good((await cli(['threads', 'list', '--input', '-'], listParams)).value); assert(listed.items.length > 0); assert(listed.items.length <= 3);
  assert(listed.items.every(t => Object.keys(t).every(k => ['threadId', 'connectionId', 'status', 'statusKnown'].includes(k))));
  if (listed.nextCursor) { const next = good(await ipc('threads.list', { ...listParams, cursor: listed.nextCursor })); assert(next.items.length <= 3); }
  mark('本机 Codex 会话分页与游标读取成功，只返回身份及状态，无标题、摘要或聊天正文');
  const params = { connectionId: connection.connectionId, threadId: target };
  const thread = good((await cli(['threads', 'get', '--input', '-'], params)).value); assert.equal(thread.threadId, target); assert.equal(thread.source, 'live'); assert.equal(thread.completionConfirmed, false);
  assert(!JSON.stringify(thread).includes('objective')); assert(!('turns' in thread)); assert(!('title' in thread));
  const mcpThread = good((await client.callTool({ name: 'threads_get', arguments: params })).structuredContent); assert.equal(mcpThread.threadId, target);
  mark('当前真实会话及最新轮次状态读取成功，目标身份一致；MCP 共用处理器且不透传正文');
  const goal = good((await cli(['goals', 'get', '--input', '-'], params)).value);
  assert.equal(goal.availability, 'known', '真实 Goal 源库必须成功读取；unknown 只能算异常证据'); assert.equal(goal.desktopThreadVerified, true); assert.equal(goal.goalAccountBindingVerified, false); assert.equal(goal.completionConfirmed, false);
  mark('真实 Goal 源库只读查询成功，明确报告当前是否有 Goal，并保留跨源账号绑定未证实标记');
  const mismatch = await cli(['threads', 'get', '--input', '-'], { ...params, connectionId: randomUUID() }); assert.equal(mismatch.code, 4); assert.equal(mismatch.value.error.code, 'CONNECTION_IDENTITY_CHANGED');
  const unknownTarget = await cli(['threads', 'get', '--input', '-'], { ...params, threadId: randomUUID() }); assert.equal(unknownTarget.code, 5); assert.equal(unknownTarget.value.error.code, 'PROVIDER_UNAVAILABLE');
  mark('失效连接引用和真实不存在会话均明确失败，不返回空数据冒充读取成功');
  assert.equal((await ipc('threads.send', { threadId: target, prompt: 'never-dispatched' })).error.code, 'CAPABILITY_UNSUPPORTED');
  const tools = (await client.listTools()).tools; assert.equal(tools.length, 15); assert(!tools.some(t => /send|consume|reset/i.test(t.name)));
  connection = good(await ipc('connections.get')); const calls = connection.readCalls;
  assert(Object.keys(calls).every(k => ['get_usage_limits', 'list_threads', 'read_thread'].includes(k))); assert(calls.get_usage_limits > 0 && calls.list_threads > 0 && calls.read_thread > 0);
  mark('公开目录不含发送/卡消费，传输调用审计仅出现三项只读工具');
  const worker = good(await ipc('app.status')).workerPid; const broker = descriptor.brokerPid;
  await desktop.close(); desktop = undefined; await until(() => !alive(worker) && !alive(broker), '退出清理只读连接及子进程'); await assert.rejects(access(join(directory, 'endpoint.json')));
  const own = new DatabaseSync(join(directory, 'codex-dog.sqlite'), { readOnly: true });
  try { assert.equal(own.prepare('SELECT count(*) n FROM observations').get().n, 0); assert.equal(own.prepare('SELECT count(*) n FROM fixture_attempts').get().n, 0); } finally { own.close(); }
  assert.equal((await cli(['quota', 'get'])).value.error.code, 'APP_NOT_RUNNING');
  assert.equal((await client.callTool({ name: 'quota_get', arguments: {} })).structuredContent.error.code, 'APP_NOT_RUNNING');
  mark('退出结束只读业务连接，CLI/MCP 离线不拉起应用；自身 SQLite 未写入真实观察或投递意图');
  assert.deepEqual(pageErrors, []);
  await mkdir('artifacts/g04', { recursive: true });
  const report = { result: 'passed', createdAt: new Date().toISOString(), version: '0.4.0-g04', apiVersion: '3', evidence: 'real-readonly', checks, pageErrors, readonlyToolCalls: calls, messageSends: 0, resetConsumptions: 0, rawAccountOrContentPersisted: false, goal: { availability: goal.availability, hasCurrent: goal.current !== null, status: goal.current?.status ?? null, desktopThreadVerified: true, crossSourceAccountBindingVerified: false, completionConfirmed: false }, sourceSelection: { candidateCount: discovered.candidates.length, callerExplicit: true }, fixtureEvidence: 'node --test test/readonly.test.ts; unit-tests.tap records injected errors separately', scope: 'G04 readonly observations verified; G05-G06 pending; no sending authorization' };
  await writeFile('artifacts/g04/report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await client?.close().catch(() => {}); await transport?.close().catch(() => {}); await desktop?.close().catch(() => {}); }
