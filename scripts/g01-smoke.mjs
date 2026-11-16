import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connect } from 'node:net';
import electron from 'electron';
import { _electron } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const profile = `smoke-${randomUUID().slice(0, 8)}`;
const executable = resolve('release/g01/codex-dog.exe');
const checks = [];
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const executableEnv = { ...env, PATH: '', NODE_OPTIONS: '' };
let desktop;
let client;
let transport;
let workerPid;
let descriptor;
const pageErrors = [];
async function cli(args, stdin) {
  return new Promise((resolveCall, reject) => {
    const child = spawn(executable, [...args, '--profile', profile, '--json'], { env: executableEnv, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('CLI 超时')); }, 15000);
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); try { resolveCall({ code, stdout, stderr, value: JSON.parse(stdout) }); } catch { reject(new Error(`CLI 非 JSON 输出：${stdout}\n${stderr}`)); } });
    child.stdin.end(stdin);
  });
}
async function rawFrame(endpoint, value) {
  return new Promise((resolveCall, reject) => {
    const socket = connect(endpoint.pipe); let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('wire 超时')); }, 5000);
    socket.on('error', error => { clearTimeout(timer); reject(error); });
    socket.once('connect', () => { const payload = Buffer.from(JSON.stringify(value)); const header = Buffer.alloc(4); header.writeUInt32LE(payload.length); socket.write(Buffer.concat([header, payload])); });
    socket.on('data', chunk => { buffer = Buffer.concat([buffer, chunk]); if (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) { clearTimeout(timer); socket.destroy(); resolveCall(JSON.parse(buffer.subarray(4).toString('utf8'))); } });
  });
}
try {
  await access(executable);
  const offline = await cli(['quota', 'get']); assert.equal(offline.code, 5); assert.equal(offline.value.error.code, 'APP_NOT_RUNNING'); checks.push('独立 EXE 在 PATH 为空且应用离线时返回 5，不自动启动应用');
  desktop = await _electron.launch({ executablePath: electron, args: ['.', `--profile=${profile}`, '--fixture=available'], env, timeout: 30000 });
  const page = await desktop.firstWindow(); page.on('pageerror', error => pageErrors.push(error.message));
  await page.waitForFunction(() => document.getElementById('state')?.textContent?.includes('source=fixture'));
  const ipc = await page.evaluate(() => window.codexDog.request('quota.get'));
  assert(ipc.ok); assert.equal(ipc.data.source, 'fixture'); assert.equal(ipc.data.available, true); workerPid = ipc.meta.workerPid;
  assert.notEqual(workerPid, desktop.process().pid); checks.push('Electron 沙箱窗口经受限 IPC 调用独立业务进程');
  const command = await cli(['quota', 'get']); assert.equal(command.code, 0); assert.equal(command.stderr, '');
  assert.deepEqual(command.value.data, ipc.data); assert.equal(command.value.meta.handlerInstanceId, ipc.meta.handlerInstanceId); checks.push('独立 EXE 与 IPC 共用同一业务快照和处理器实例');
  const caps = await cli(['capabilities', 'list']); assert.equal(caps.value.data.capabilities.length, 5);
  const described = await cli(['capabilities', 'describe', '--operation', 'quota.get']); assert.equal(described.value.data.inputSchema.additionalProperties, false);
  checks.push('能力发现只列 5 项已实现能力，Schema 来自统一声明');
  const invalid = await cli(['quota', 'get', '--input', '-'], '{"injected":true}'); assert.equal(invalid.code, 2); assert.equal(invalid.value.error.code, 'INVALID_ARGUMENT');
  const invalidIpc = await page.evaluate(() => window.codexDog.request('quota.get', { injected: true })); assert.equal(invalidIpc.error.code, invalid.value.error.code);
  const unsupported = await cli(['threads', 'send']); assert.equal(unsupported.code, 5); checks.push('CLI 与 IPC 拒绝额外参数，未实现发送不能调用');
  transport = new StdioClientTransport({ command: executable, args: ['mcp', 'serve', '--profile', profile], env: executableEnv, stderr: 'pipe' });
  client = new Client({ name: 'codex-dog-g01-validation', version: '1.0.0' }); await client.connect(transport);
  const tools = await client.listTools(); assert.equal(tools.tools.length, 5);
  const mcp = await client.callTool({ name: 'quota_get', arguments: {} }); assert.equal(mcp.isError, false);
  const mcpValue = mcp.structuredContent; assert(mcpValue?.ok); assert.deepEqual(mcpValue.data, ipc.data); assert.equal(mcpValue.meta.handlerInstanceId, ipc.meta.handlerInstanceId); assert.equal(mcpValue.meta.workerPid, workerPid);
  checks.push('官方 MCP 客户端通过独立 EXE stdio 与 CLI/IPC 共用同一处理器');
  const invalidMcp = await client.callTool({ name: 'quota_get', arguments: { injected: true } }); assert.equal(invalidMcp.isError, true); assert.equal(invalidMcp.structuredContent.error.code, invalid.value.error.code);
  checks.push('MCP 业务参数也由同一处理器校验，与 CLI/IPC 返回相同 INVALID_ARGUMENT');
  const ipcSandbox = await page.evaluate(() => ({ requireType: typeof window.require, processType: typeof window.process })); assert.deepEqual(ipcSandbox, { requireType: 'undefined', processType: 'undefined' });
  const paths = await desktop.evaluate(({ app }) => app.getPath('userData')); descriptor = JSON.parse(await readFile(resolve(paths, '..', 'endpoint.json'), 'utf8'));
  const badAuth = await rawFrame(descriptor, { token: '0'.repeat(64), request: { apiVersion: '1', requestId: 'bad-auth', operation: 'quota.get', params: {} } }); assert.equal(badAuth.error.code, 'PERMISSION_DENIED');
  const badVersion = await rawFrame(descriptor, { token: descriptor.token, request: { apiVersion: '2', requestId: 'bad-version', operation: 'quota.get', params: {} } }); assert.equal(badVersion.error.code, 'PROTOCOL_INCOMPATIBLE');
  const oversized = await rawFrame(descriptor, { token: descriptor.token, request: { apiVersion: '1', requestId: 'oversized', operation: 'quota.get', params: { data: 'x'.repeat(1024 * 1024) } } }); assert.equal(oversized.error.code, 'INPUT_TOO_LARGE');
  checks.push('渲染层无 Node 权限，会话凭据错误与超大请求被拒绝');
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  const hidden = await cli(['quota', 'get']); assert.equal(hidden.code, 0); checks.push('窗口隐藏后应用仍运行并可调用（本阶段未实现托盘）');
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
  await mkdir('artifacts/g01', { recursive: true }); await page.screenshot({ path: 'artifacts/g01/window.png' });
  assert.deepEqual(pageErrors, []);
  await desktop.close(); desktop = undefined;
  const after = await cli(['quota', 'get']); assert.equal(after.code, 5);
  const offlineMcp = await client.callTool({ name: 'quota_get', arguments: {} }); assert.equal(offlineMcp.isError, true); assert.equal(offlineMcp.structuredContent.error.code, 'APP_NOT_RUNNING');
  await client.close(); client = undefined; transport = undefined;
  let alive = true; try { process.kill(workerPid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; } assert.equal(alive, false);
  checks.push('退出后 CLI/MCP 返回离线，业务子进程结束；MCP 桥接不启动主应用');
  const report = { result: 'passed', createdAt: new Date().toISOString(), appVersion: '0.1.0-g01', nodeVersion: process.version, fixture: 'available', dataSource: 'fixture', checks, pageErrors, handlers: { runtimeId: ipc.meta.runtimeId, handlerInstanceId: ipc.meta.handlerInstanceId, workerPid }, realCodexConnections: 0, scope: 'G01 only; G02–G06 not passed' };
  await writeFile('artifacts/g01/report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally {
  await client?.close().catch(() => {}); await transport?.close().catch(() => {}); await desktop?.close().catch(() => {});
}
