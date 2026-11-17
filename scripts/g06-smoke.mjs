import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { launchSmokeHost } from './electron-smoke-host.mjs';
import { windowsPowerShellEnvironment, isWindowsPowerShell } from '../packages/infrastructure/windows-powershell.ts';

const pack = JSON.parse(await readFile('artifacts/g06/package.json', 'utf8')); assert.equal(pack.mode, 'preview'); assert.equal(pack.signed, false);
const directory = resolve('artifacts/g06/installed', pack.runId); const executable = join(directory, pack.executable); const cli = join(directory, 'resources/cli/codex-dog.exe');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
async function command(file, args) {
  return new Promise((resolveCall, reject) => {
    const child = spawn(file, args, { env: isWindowsPowerShell(file) ? windowsPowerShellEnvironment(env) : env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = ''; child.stdout.on('data', data => { stdout += data; }); child.stderr.resume();
    const timer = setTimeout(() => { child.kill(); reject(new Error('隔离 G06 子进程超时')); }, 180000);
    child.once('error', error => { clearTimeout(timer); reject(error); }); child.once('exit', code => { clearTimeout(timer); resolveCall({ code, stdout }); });
  });
}
const checks = []; const pageErrors = []; let desktop;
const mark = text => { checks.push(text); console.log('[G06] ' + text); };
try {
  await mkdir(directory, { recursive: true }); assert.equal((await command(pack.installer, ['/S', '/D=' + directory])).code, 0); await access(executable); await access(cli);
  const host = await launchSmokeHost({ executablePath: executable, env }, 'g06'); desktop = host.desktop; const page = host.page; page.on('pageerror', error => pageErrors.push(error.message)); await page.waitForFunction(() => document.getElementById('state')?.textContent?.includes('source=fixture'));
  const request = (operation, params = {}) => page.evaluate(({ operation, params }) => window.codexDog.request(operation, params), { operation, params });
  const version = await request('app.version'); assert.equal(version.data.version, pack.version); assert.equal((await command(cli, ['--version'])).stdout.trim(), pack.version); assert.equal((await request('app.status')).data.realCodexConnected, false);
  mark('实际 per-user Preview NSIS 安装，主应用/worker/独立 CLI 版本一致，强制模拟数据');
  const manifest = JSON.parse(await readFile(join(directory, 'resources/dog-distribution.json'), 'utf8')); assert.equal(manifest.profile, pack.profile); assert.equal(manifest.kind, 'release-preview'); assert(pack.appId.endsWith('.preview'));
  const updates = await request('updates.status'); assert.equal(updates.data.supported, false); assert.equal(updates.data.unsignedTestDistribution, true); assert.equal((await request('updates.check')).error.code, 'UPDATE_UNSUPPORTED');
  await assert.rejects(access(join(pack.output, 'beta.yml'))); await assert.rejects(access(join(pack.output, 'latest.yml')));
  mark('Preview 身份/数据与 Beta/Stable 分离，无更新清单且不允许下载或安装官方更新');
  const signature = await command(join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', resolve('build/verify-signature.ps1'), '-FilePath', pack.installer, '-PublisherName', 'fixture-not-a-publisher']); assert.equal(signature.code, 75);
  mark('真实 Windows Authenticode 门禁拒绝未签名 Preview 安装包，未以模拟签名冒充真实证书');
  const location = join(process.env.LOCALAPPDATA, 'codex-dog/profiles', pack.profile); const endpoint = JSON.parse(await readFile(join(location, 'endpoint.json'), 'utf8')); const worker = (await request('app.status')).data.workerPid;
  await desktop.close(); desktop = undefined;
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const deadline = Date.now() + 10000; while ([endpoint.appPid, endpoint.brokerPid, worker].some(alive)) { if (Date.now() > deadline) throw new Error('Preview 退出清理超时'); await new Promise(resolveCall => setTimeout(resolveCall, 100)); }
  await assert.rejects(access(join(location, 'endpoint.json'))); assert.equal(JSON.parse((await command(cli, ['app', 'version', '--profile', pack.profile, '--json'])).stdout).error.code, 'APP_NOT_RUNNING');
  mark('Preview 正常退出清理自建进程和端点，离线 CLI 不拉起后台'); assert.deepEqual(pageErrors, []);
  await writeFile('artifacts/g06/preview-report.json', JSON.stringify({ result: 'passed', createdAt: new Date().toISOString(), version: pack.version, appId: pack.appId, profile: pack.profile, checks, pageErrors, realCodexConnections: 0, messageSends: 0, resetConsumptions: 0, signedCertificateVerified: false, signatureNegativeVerified: true, githubActionsRun: false, stablePublished: false }, null, 2));
} finally { await desktop?.close().catch(() => {}); }
