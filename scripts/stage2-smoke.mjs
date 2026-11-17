import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import electron from 'electron';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { launchSmokeHost } from './electron-smoke-host.mjs';

const installed = process.argv.includes('--installed'); const live = process.argv.includes('--live');
assert(!live || process.env.GITHUB_ACTIONS !== 'true', 'runner 不执行真实只读接入');
assert(!live || /^[a-f0-9-]{36}$/i.test(process.env.CODEX_THREAD_ID ?? ''), '真实只读验收必须明确提供 CODEX_THREAD_ID');
const pack = installed ? JSON.parse(await readFile('artifacts/g06/package.json', 'utf8')) : null;
const executablePath = installed ? resolve('artifacts/g06/installed', pack.runId, pack.executable) : electron;
const cliPath = installed ? join(resolve('artifacts/g06/installed', pack.runId), 'resources/cli/codex-dog.exe') : resolve('release/g06/codex-dog.exe');
const profile = 'stage2-' + randomUUID().slice(0, 8); const directory = join(process.env.LOCALAPPDATA, 'codex-dog/profiles', profile);
const reportDirectory = 'artifacts/stage2'; const label = (installed ? 'installed-' : 'development-') + (live ? 'live' : 'fixture');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let desktop; let page; let descriptor; let mcp; let transport; const checks = []; const pageErrors = []; const consoleErrors = [];
const mark = value => { checks.push(value); console.log('[阶段2] ' + value); };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(check, message, timeout = 20000) { const start = Date.now(); while (!(await check())) { if (Date.now() - start > timeout) throw new Error(message); await new Promise(resolve => setTimeout(resolve, 80)); } }
async function cli(args, input, name = 'reader') {
  return new Promise((resolveCall, reject) => {
    const child = spawn(cliPath, [...args, '--profile', profile, '--client', name, '--json'], { windowsHide: true, env: { ...env, PATH: '', NODE_OPTIONS: '' }, stdio: 'pipe' }); let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('CLI 验收超时')); }, 40000);
    child.stdout.on('data', data => { output += data; }); child.stderr.resume(); child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); try { resolveCall({ code, value: JSON.parse(output) }); } catch { reject(new Error('CLI 未返回 JSON')); } });
    child.stdin.end(input ? JSON.stringify(input) : undefined);
  });
}
const ipc = (operation, params = {}, key) => page.evaluate(({ operation, params, key }) => window.codexDog.request(operation, params, key), { operation, params, key });
const good = response => { assert(response.ok, response.error?.code); return response.data; };
async function launch(extra = []) {
  ({ desktop, page } = await launchSmokeHost({ executablePath, args: [...(installed ? [] : ['.']), `--profile=${profile}`, ...extra], env, timeout: 35000 }, label, undefined, reportDirectory));
  page.on('pageerror', cause => pageErrors.push(cause.message)); page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300)); });
  await page.waitForFunction(() => document.getElementById('state')?.textContent?.includes('source=fixture') || document.getElementById('state')?.textContent?.includes('PROVIDER_') || document.getElementById('state')?.textContent?.includes('source=live'));
  descriptor = JSON.parse(await readFile(join(directory, 'endpoint.json'), 'utf8'));
  const status = good(await ipc('app.status')); assert.equal(status.trayAvailable, true); assert.equal(status.windowVisible, true); assert.equal(status.state, 'running');
}
async function quit(viaUi = false) {
  const status = good(await ipc('app.status')); const old = descriptor;
  if (viaUi) { await page.getByRole('button', { name: '退出并停止监控', exact: true }).click(); await page.getByRole('button', { name: '确认退出', exact: true }).click(); }
  else good((await cli(['app', 'quit', '--input', '-', '--idempotency-key', randomUUID()], { expectedInstanceId: status.instanceId, confirm: true }, 'manager')).value);
  await until(() => ![old.appPid, old.brokerPid, status.workerPid].some(alive), '退出后仍存在本实例进程');
  await assert.rejects(access(join(directory, 'endpoint.json'))); await desktop.close().catch(() => {}); desktop = undefined;
  assert.equal((await cli(['quota', 'get'])).value.error.code, 'APP_NOT_RUNNING');
  if (mcp) assert.equal((await mcp.callTool({ name: 'quota_get', arguments: {} })).structuredContent.error.code, 'APP_NOT_RUNNING');
}
try {
  await mkdir(reportDirectory, { recursive: true });
  assert.equal((await cli(['quota', 'get'])).value.error.code, 'APP_NOT_RUNNING');
  await launch(['--source=fixture', '--fixture=available']);
  assert.equal(await page.locator('#quota-status').textContent(), '额度可用'); assert.equal(good(await ipc('quota.get')).source, 'fixture');
  await page.screenshot({ path: `${reportDirectory}/${label}-overview.png` });
  await page.setViewportSize({ width: 840, height: 620 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await page.setViewportSize({ width: 1140, height: 800 });
  mark('Vue 主窗口与额度总览、最小尺寸布局可用，默认模拟且无真实连接');
  const pairing = good((await cli(['access', 'request'])).value);
  await page.getByRole('button', { name: '客户端授权', exact: true }).click(); const card = page.locator(`[data-client-id="${pairing.id}"]`);
  await card.getByRole('textbox', { name: '配对码' }).fill(pairing.code); await card.getByRole('button', { name: '批准读取', exact: true }).click();
  await until(async () => (await cli(['quota', 'get'])).code === 0, '桌面批准未传播');
  assert.equal((await cli(['connections', 'configure', '--input', '-'], { expectedRevision: 1, source: 'fixture', callerThreadId: '', pipe: '' })).value.error.code, 'PERMISSION_DENIED');
  transport = new StdioClientTransport({ command: cliPath, args: ['mcp', 'serve', '--profile', profile, '--client', 'reader'], env: { ...env, PATH: '', NODE_OPTIONS: '' }, stderr: 'pipe' });
  mcp = new Client({ name: 'stage2-acceptance', version: '1' }); await mcp.connect(transport); transport.stderr?.resume();
  assert.equal((await mcp.listTools()).tools.length, 23); const initial = good(await ipc('quota.get'));
  assert.deepEqual(good((await cli(['quota', 'get'])).value), initial); assert.deepEqual(good((await mcp.callTool({ name: 'quota_get', arguments: {} })).structuredContent), initial);
  mark('桌面配对、CLI/MCP 统一读取及默认 read 权限保持，不能自授来源配置权限');
  const manager = good((await cli(['access', 'request', '--input', '-'], { clientLabel: 'stage2-manager', requestedScopes: ['read', 'app.manage'] }, 'manager')).value);
  const managerCard = page.locator(`[data-client-id="${manager.id}"]`); await managerCard.getByRole('textbox', { name: '配对码' }).fill(manager.code);
  await managerCard.getByRole('checkbox', { name: '允许下载和安装更新' }).check(); await managerCard.getByRole('button', { name: '批准读取', exact: true }).click();
  await until(async () => (await cli(['connections', 'configuration'], undefined, 'manager')).code === 0, '管理客户端未配对');
  const fixtureConfig = { expectedRevision: 1, source: 'fixture', callerThreadId: '', pipe: '' };
  const configured = good((await cli(['connections', 'configure', '--input', '-', '--idempotency-key', 'fixture-selection'], fixtureConfig, 'manager')).value);
  assert.equal(configured.revision, 2); assert.deepEqual(good((await cli(['connections', 'configure', '--input', '-', '--idempotency-key', 'fixture-selection'], fixtureConfig, 'manager')).value), configured);
  mark('CLI 在显式 app.manage 配对后保存来源，同键重试保持修订；窗口配置页复用该服务');
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await until(async () => good((await cli(['app', 'status'])).value).windowVisible === false, '关闭窗口未隐藏');
  assert.deepEqual(good((await mcp.callTool({ name: 'quota_get', arguments: {} })).structuredContent), initial);
  good((await cli(['desktop', 'show'])).value); await until(async () => good(await ipc('app.status')).windowVisible, '重开窗口失败');
  const trayMenu = await desktop.evaluate(({ app }) => app.getName()); assert(trayMenu);
  mark('实际窗口 close 后驻托盘，CLI/MCP 继续查询，统一 desktop.show 重新打开原窗口');
  await card.getByRole('button', { name: '撤销授权', exact: true }).click(); await until(async () => (await cli(['quota', 'get'])).value.error.code === 'AUTH_REVOKED', '撤销未生效');
  assert.equal((await mcp.callTool({ name: 'quota_get', arguments: {} })).structuredContent.error.code, 'AUTH_REVOKED');
  mark('撤销授权立即传播到 CLI 和长期 MCP，未回退为共享授权');
  await page.getByRole('button', { name: '连接与来源', exact: true }).click();
  await page.getByLabel('数据来源', { exact: true }).selectOption('live-readonly');
  await page.getByLabel('调用会话 ID', { exact: true }).fill(live ? process.env.CODEX_THREAD_ID : randomUUID());
  await page.getByLabel('本机工具管道', { exact: true }).fill(live ? process.env.CODEX_DOG_LIVE_PIPE ?? '' : '\\\\.\\pipe\\codex-app-tools-stage2-absent-' + randomUUID());
  await page.getByRole('button', { name: '保存来源选择', exact: true }).click();
  await until(async () => good(await ipc('connections.configuration')).restartRequired === true, '来源未保存'); assert.equal(good(await ipc('app.status')).mode, 'fixture');
  await quit(true); mark('保存来源不改变当前运行；明确退出清理本实例端点和子进程，CLI/MCP 离线且不拉起');
  await launch(); const current = good(await ipc('app.status')); assert.equal(current.mode, 'live-readonly');
  if (live) {
    const refreshed = good(await ipc('quota.refresh')); assert.equal(refreshed.source, 'live'); assert.equal(refreshed.stale, false); assert.equal(refreshed.windows.length, 2);
    const connection = good(await ipc('connections.get')); assert.equal(connection.state, 'ready'); assert.equal(connection.identityVerified, true);
    assert(Object.keys(connection.readCalls).every(key => key === 'get_usage_limits'));
    const livePair = good((await cli(['access', 'request'], undefined, 'live-reader')).value);
    await page.getByRole('button', { name: '客户端授权', exact: true }).click(); const liveCard = page.locator(`[data-client-id="${livePair.id}"]`);
    await liveCard.getByRole('textbox', { name: '配对码' }).fill(livePair.code); await liveCard.getByRole('button', { name: '批准读取', exact: true }).click();
    await until(async () => (await cli(['quota', 'get'], undefined, 'live-reader')).code === 0, '真实只读客户端未配对');
    await mcp.close(); await transport.close();
    transport = new StdioClientTransport({ command: cliPath, args: ['mcp', 'serve', '--profile', profile, '--client', 'live-reader'], env: { ...env, PATH: '', NODE_OPTIONS: '' }, stderr: 'pipe' });
    mcp = new Client({ name: 'stage2-live-acceptance', version: '1' }); await mcp.connect(transport); transport.stderr?.resume();
    assert.deepEqual(good((await cli(['quota', 'get'], undefined, 'live-reader')).value), good(await ipc('quota.get')));
    assert.deepEqual(good((await mcp.callTool({ name: 'quota_get', arguments: {} })).structuredContent), good(await ipc('quota.get')));
    await page.getByRole('button', { name: '额度总览', exact: true }).click(); await page.getByRole('button', { name: '刷新真实额度', exact: true }).click();
    await until(async () => (await page.locator('#state').textContent()).includes('source=live'), '真实额度未展示');
    await page.screenshot({ path: `${reportDirectory}/${label}-live.png` });
    await page.clock.setFixedTime(new Date(Date.now() + 31000)); await page.waitForFunction(() => document.getElementById('quota-status')?.textContent === '观察已过期');
    mark('显式持久选择真实只读来源，真实额度和连接验证通过；页面时钟推进验证过期不显示正常（底层时间未快进）');
  } else {
    const unavailable = await ipc('quota.get'); assert.equal(unavailable.ok, false); assert.equal(good(await ipc('connections.get')).state, 'unavailable');
    await page.waitForFunction(() => document.getElementById('quota-status')?.textContent !== '额度可用'); assert.equal(good(await ipc('app.status')).mode, 'live-readonly');
    mark('不可达的显式只读来源保持异常，未自动回退模拟或显示额度正常；此项为断连夹具，无真实来源证据');
  }
  await quit();
  if (!live) for (const [scenario, title] of [['blocked', '额度已耗尽'], ['unknown', '额度未知']]) {
    await launch(['--source=fixture', `--fixture=${scenario}`]); assert.equal(await page.locator('#quota-status').textContent(), title); await quit(); mark(`模拟 ${scenario} 确定性展示 ${title}`);
  }
  assert.deepEqual(pageErrors, []); assert.deepEqual(consoleErrors, []);
  const report = { result: 'passed', createdAt: new Date().toISOString(), installed, evidence: live ? 'real-readonly-plus-fixture' : 'fixture-and-explicit-unavailable-source', githubActionsRun: process.env.GITHUB_ACTIONS === 'true', githubRunId: process.env.GITHUB_RUN_ID ?? null, checks, pageErrors, consoleErrors, messageSends: 0, resetConsumptions: 0, realSourceTested: live, signed: false };
  await writeFile(`${reportDirectory}/${label}.json`, JSON.stringify(report, null, 2));
} finally { await mcp?.close().catch(() => {}); await transport?.close().catch(() => {}); await desktop?.close().catch(() => {}); }
