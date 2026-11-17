import type {SourceSelection} from '../../packages/app/source-configuration.ts';
import { app, BrowserWindow, ipcMain, utilityProcess, Tray, Menu, nativeImage,shell,Notification,powerMonitor } from 'electron';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { writeFile, rename, readFile, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { apiVersion, failure, wireSchema, version } from '../../packages/contracts/protocol.ts';
import { locations } from '../../packages/infrastructure/local-transport.ts';
import { SecurePipeHost } from '../../packages/infrastructure/secure-pipe.ts';
import { FileAccessStore } from '../../packages/infrastructure/access-store.ts';
import { AccessService } from '../../packages/modules/access/service.ts';
import { WorkerSupervisor } from '../../packages/app/worker-supervisor.ts';
import { HostRouter } from '../../packages/app/router.ts';
import { seal, unseal, packetIv } from '../../packages/infrastructure/channel.ts';
import { UpdateService } from '../../packages/update/service.ts';
import { UpdateError } from '../../packages/update/ports.ts';
import { WindowsUpdateBackend } from '../../packages/infrastructure/windows-update-backend.ts';
import { FileUpdateStore } from '../../packages/infrastructure/update-store.ts';
import { parseDistribution } from '../../packages/infrastructure/distribution.ts';
import { formatStartupDiagnostic } from '../../packages/infrastructure/startup-diagnostics.ts';
import { windowsPowerShellEnvironment } from '../../packages/infrastructure/windows-powershell.ts';
import { SourceConfiguration } from '../../packages/app/source-configuration.ts';
import { FileSourceStore } from '../../packages/infrastructure/source-store.ts';
import { AppearancePreview } from '../../packages/app/appearance-preview.ts';
import { Stage3Error } from '../../packages/modules/persistence/stage3-ports.ts';

const argument = (name: string, fallback: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
let startupStage = 'bootstrap';
function startupPhase(stage: string) { startupStage = stage; if (process.env.CODEX_DOG_STARTUP_DIAGNOSTICS === '1') console.error(formatStartupDiagnostic(stage, 'BEGIN')); }
const distributionFile = app.isPackaged ? join(process.resourcesPath, existsSync(join(process.resourcesPath, 'dog-distribution.json')) ? 'dog-distribution.json' : 'g05-distribution.json') : undefined;
const distribution = distributionFile ? parseDistribution(JSON.parse(readFileSync(distributionFile, 'utf8'))) : undefined;
const profile = argument('profile', distribution?.profile ?? 'g02');
const scenario = argument('fixture', 'available');
let sourceMode = argument('source', 'fixture') as 'fixture' | 'live-readonly';
if (sourceMode !== 'fixture' && sourceMode !== 'live-readonly') throw new Error('来源模式无效');
if (distribution?.kind === 'g05-test' && sourceMode !== 'fixture') throw new Error('历史 G05 安装包仅允许模拟来源');
if (process.argv.some(a => a.startsWith('--g05-fixture-port=')) && distribution?.kind !== 'g05-test') throw new Error('非 G05 测试包不接受回环更新源');
const testHooks = sourceMode === 'fixture' && process.argv.includes('--g02-test-hooks');
if (!['available', 'blocked', 'unknown'].includes(scenario)) throw new Error('模拟场景无效');
const paths = locations(profile);
app.setPath('userData', join(paths.directory, 'electron'));
const instanceId = randomUUID();
const transportKey = randomBytes(32).toString('hex');
let ownerSid = '';
let stopping = false;
let initialized = false;
let startupTask: Promise<void> | undefined;
let exitAllowed = false;
let stopTask: Promise<void> | undefined;
let window: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitTimer: NodeJS.Timeout | undefined;
const configuration = new SourceConfiguration(new FileSourceStore(join(paths.directory, 'source.json')));
let selection:SourceSelection = { source: sourceMode, callerThreadId: argument('codex-caller-thread', process.env.CODEX_THREAD_ID ?? ''), pipe: argument('codex-pipe', '') };
function showWindow() { if (stopping || !window || window.isDestroyed()) return; if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
const access = new AccessService({ store: new FileAccessStore(join(paths.directory, 'access.json')), now: () => Date.now(), newCode: () => randomBytes(3).toString('hex').toUpperCase(),
  digest: value => createHash('sha256').update(value).digest('hex'), equal: (a, b) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); } });
const runtime = new WorkerSupervisor({notify:kind=>{if(stopping||!Notification.isSupported())return;const messages={quota_recovered:'额度已恢复；仅观察任务保持观察。',task_completed:'已核对任务完成，请查看任务归档。',reset_result:'重置卡预约状态有更新，请查看预约与消费核对。'};const notification=new Notification({title:'Codex Dog · 守码犬',body:messages[kind],icon:join(__dirname,'icon.png')});notification.on('click',showWindow);notification.show();}, authorize:(actor,scope)=>{if(stopping)throw new Stage3Error('APP_STOPPING','应用正在退出');access.assertRevision(actor,scope);},now: () => performance.now(), newId: randomUUID, requestTimeout: 45000, startupTimeout: 45000, spawn: () => {
  const child = utilityProcess.fork(join(__dirname, 'worker.cjs'), [], { serviceName: 'Codex Dog business worker', stdio: 'pipe', env: { ...process.env, CODEX_DOG_FIXTURE: scenario,
    CODEX_DOG_CARD_EXECUTABLE:selection.cardExecutable??'',CODEX_DOG_ALLOW_CARD_CONSUMPTION:selection.allowCardConsumption===true?'1':'0',CODEX_DOG_TEST_DELIVERY_LOSS:testHooks&&argument('test-delivery-loss','0')==='1'?'1':'0',CODEX_DOG_TEST_CARD_LOSS:testHooks&&argument('test-card-loss','0')==='1'?'1':'0',CODEX_DOG_PARENT_PID: String(process.pid), CODEX_DOG_SOURCE: sourceMode, CODEX_DOG_CODEX_PIPE: selection.pipe, CODEX_DOG_CALLER: selection.callerThreadId, CODEX_DOG_CODEX_HOME: argument('codex-home', process.env.CODEX_HOME ?? ''), CODEX_DOG_DATA_DIRECTORY: paths.directory, CODEX_DOG_TEST_HOOKS: testHooks ? '1' : '0', CODEX_DOG_TEST_EXPORT_DELAY_MS:testHooks?argument('test-export-delay-ms','5'):'5',CODEX_DOG_TEST_DELAY_MS: testHooks ? argument('test-delay-ms', '0') : '0' } });
  child.stderr?.on('data', () => console.error('业务进程报告错误，请查看诊断状态'));
  return { get pid() { return child.pid; }, send: value => child.postMessage(value), kill: () => { child.kill(); }, onMessage: listener => { child.on('message', listener); }, onExit: listener => { child.once('exit', listener); } };
} });
const updateBackend = new WindowsUpdateBackend({ packaged: app.isPackaged, testDistribution: distribution?.kind === 'g05-test', executable: process.execPath, directory: paths.directory, ...(distribution?.kind === 'release' ? { release: { channel: distribution.channel, publisherName: distribution.publisherName, signatureScript: join(process.resourcesPath, 'verify-signature.ps1') } } : {}), ...(process.argv.some(a => a.startsWith('--g05-fixture-port=')) ? { fixturePort: Number(argument('g05-fixture-port', '0')) } : {}) });
const updates = new UpdateService({ backend: updateBackend, store: new FileUpdateStore(join(paths.directory, 'updates.json')), version: app.isPackaged ? app.getVersion() : version, channel: distribution?.kind === 'release' ? distribution.channel : 'beta', unsignedTestDistribution: distribution?.kind !== 'release', now: Date.now, newId: randomUUID,
  digest: value => createHash('sha256').update(value).digest('hex'), lifecycle: {
    recoverPreparation:async()=>{if(stopping)return;const result=await runtime.invoke({apiVersion,requestId:randomUUID(),operation:'system.cancel-prepare-update',params:{}});if(!result.ok)throw new UpdateError('APP_NOT_READY','更新准备失败后业务恢复仍需核对');},
    prepare: async installId => {
      await assertCliFree();
      const result = await runtime.invoke({ apiVersion, requestId: randomUUID(), operation: 'system.prepare-update', params: { installId } });
      if (!result.ok) throw new UpdateError('STORAGE_FAILURE', '安装前备份失败');
      await assertCliFree();
    },
    install: async (artifact, finalGuard) => {
      const owned = [runtime.health().workerPid, pipe.processId()].filter((pid): pid is number => typeof pid === 'number');
      await stop(true);
      try {
        const deadline = performance.now() + 3000;
        const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; } };
        while (owned.some(alive)) { if (performance.now() > deadline) throw new UpdateError('UPDATE_EXIT_FAILED', '自建子进程未完全退出，拒绝安装'); await new Promise(resolve => setTimeout(resolve, 50)); }
        await updateBackend.launchInstaller(artifact, finalGuard); exitAllowed = true; app.exit(0);
      }
      catch (error) { app.relaunch({ args: process.argv.slice(1) }); exitAllowed = true; app.exit(1); throw error; }
    },
  } });
const appearance=new AppearancePreview({newId:randomUUID,visible:()=>!!window&&!window.isDestroyed()&&window.isVisible()&&!stopping,apply:(values,previewId)=>{if(window&&!window.isDestroyed())window.webContents.send('dog:appearance',{values,previewId});},read:async()=>{const result=await runtime.invoke({apiVersion,requestId:randomUUID(),operation:'appearance.get',params:{}},{kind:'desktop',clientId:'desktop',revision:1});if(!result.ok)throw new Error('外观设置读取失败');return result.data as unknown as import('../../packages/modules/persistence/stage3-ports.ts').SettingView;}});
const router = new HostRouter(access, runtime, { runtimeId: instanceId, handlerInstanceId: randomUUID() }, sourceMode, updates, { configuration,appearance, desktop: {
  openDataDirectory:async()=>{const error=await shell.openPath(paths.directory);if(error)throw new Error('固定目录无法打开');},
  openConsole:()=>{if(!window||window.isDestroyed())throw new Stage3Error('WINDOW_UNAVAILABLE','诊断窗口不可用');window.webContents.openDevTools({mode:'detach'});},
  show: showWindow, quit: finalGuard => { quitTimer ??= setTimeout(() => { quitTimer = undefined; try { finalGuard(); app.quit(); } catch { /* 派发前授权已撤销，取消退出。 */ } }, 400); }, status: () => ({ windowVisible: window?.isVisible() ?? false, trayAvailable: !!tray && !tray.isDestroyed() }),
} });
const pipe = new SecurePipeHost({ script: app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked/out/windows-pipe.ps1') : join(__dirname, 'windows-pipe.ps1'), pipe: paths.pipe, directory: paths.directory, failed: () => { if (!stopping) app.quit(); },
  request: async (raw, peerSid) => {
    if (peerSid !== ownerSid) return failure('PERMISSION_DENIED', 'Windows 客户端身份不匹配');
    const iv = packetIv(raw); if (!iv) return failure('INVALID_ARGUMENT', '传输封装无效');
    const respond = (value: unknown) => seal(value, transportKey, instanceId + ':server:' + iv);
    if (!initialized) return respond(failure('APP_NOT_READY', '主应用正在初始化'));
    if (stopping) return respond(failure('APP_STOPPING', '应用正在退出'));
    let clear: unknown;
    try { clear = unseal(raw, transportKey, instanceId + ':client'); } catch { return respond(failure('PERMISSION_DENIED', '传输认证失败')); }
    const wire = wireSchema.safeParse(clear);
    if (!wire.success) {
      if (clear && typeof clear === 'object' && 'request' in clear && clear.request && typeof clear.request === 'object' && 'apiVersion' in clear.request && clear.request.apiVersion !== apiVersion) return respond(failure('PROTOCOL_INCOMPATIBLE', 'API major 不兼容'));
      return respond(failure('INVALID_ARGUMENT', '本机请求结构无效'));
    }
    return respond(await router.invoke(wire.data.request, { credential: wire.data.credential }));
  } });
async function start() {
  if (stopping) throw new Error('启动已取消');
  startupPhase('pipe');
  const identity = await pipe.start(); ownerSid = identity.ownerSid;
  if (!identity.rootProtected || identity.pipeAclVerified !== true || identity.rootAclVerified !== true) throw Object.assign(new Error('Windows ACL 校验失败'), { code: 'PIPE_ACL_INVALID' });
  if (stopping) throw new Error('启动已取消');
  startupPhase('access'); await access.start();
  selection = await configuration.start({
    ...(process.argv.some(a => a.startsWith('--source=')) || distribution?.kind === 'g05-test' ? { source: sourceMode } : {}),
    ...(process.argv.some(a => a.startsWith('--codex-pipe=')) ? { pipe: argument('codex-pipe', '') } : {}),
    ...(process.argv.some(a => a.startsWith('--codex-caller-thread=')) ? { callerThreadId: argument('codex-caller-thread', '') } : {}),
  }, process.env.CODEX_THREAD_ID ?? '');
  sourceMode = selection.source; router.setStartupMode(sourceMode);
  if (testHooks && sourceMode !== 'fixture') throw new Error('测试 bridge 只允许模拟模式');
  if (stopping) throw new Error('启动已取消');
  startupPhase('worker'); await runtime.start();
  powerMonitor.on('suspend',()=>runtime.environment('suspend'));powerMonitor.on('resume',()=>runtime.environment('resume'));
  if (stopping) throw new Error('启动已取消');
  startupPhase('update'); updateBackend.start(); await updates.start();
  initialized = true;
  await writeFile(paths.descriptor + '.tmp', JSON.stringify({ apiVersion, pipe: paths.pipe, appPid: process.pid, instanceId, ownerSid, brokerPid: identity.pid, transportKey }), { mode: 0o600 });
  await rename(paths.descriptor + '.tmp', paths.descriptor);
  if (stopping) throw new Error('启动已取消');
  startupPhase('window');
  window = new BrowserWindow({ width: 1140, height: 800, minWidth: 840, minHeight: 620, backgroundColor: '#f5f7fa', title: 'Codex Dog · 守码犬', autoHideMenuBar: true, webPreferences: { preload: join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, additionalArguments: testHooks ? ['--g03-test-hooks'] : [] } });
  window.on('close', event => { if (!stopping && !exitAllowed && tray && !tray.isDestroyed()) { event.preventDefault(); window?.hide(); } });
  window.on('hide',()=>appearance.clear());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); window.webContents.on('will-navigate', event => event.preventDefault());
  const inputSchema = z.object({ operation: z.string(), params: z.record(z.string(), z.unknown()), idempotencyKey: z.string().min(1).max(100).optional() }).strict();
  ipcMain.handle('dog:request', (event, raw: unknown) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return failure('PERMISSION_DENIED', 'IPC 来源无效');
    const input = inputSchema.safeParse(raw); if (!input.success) return failure('INVALID_ARGUMENT', 'IPC 参数无效');
    return router.invoke({ apiVersion, requestId: randomUUID(), ...input.data }, { trustedDesktop: true });
  });
  if (testHooks) app.on('dog:test:control' as never, ((_event: unknown, type: string) => { if (['test:exit', 'test:hang'].includes(type)) runtime.testControl(type); }) as never);
  if (testHooks) ipcMain.handle('dog:test:g03', (event, params: Record<string, unknown>) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) return failure('PERMISSION_DENIED', '测试 IPC 来源无效');
    return runtime.invoke({ apiVersion, requestId: randomUUID(), operation: 'g03.test', params });
  });
  await window.loadFile(join(__dirname, 'renderer/index.html'));
  tray = new Tray(nativeImage.createFromPath(join(__dirname,'icon.png')).resize({width:20,height:20}));
  tray.setToolTip('Codex Dog · 关闭窗口后继续运行');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开 Codex Dog', click: showWindow }, { type: 'separator' }, { label: '退出并停止监控', click: () => app.quit() }]));
  tray.on('double-click', showWindow); tray.on('click', showWindow);
}
async function assertCliFree() {
  if (!distribution) throw new UpdateError('UPDATE_UNSUPPORTED', '未安装 G05 测试包');
  const executable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  for (let attempt = 0; attempt < 5; attempt++) {
    const free = await new Promise<boolean>(resolve => {
      const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', join(process.resourcesPath, 'cli-file-guard.ps1'), '-CliPath', join(process.resourcesPath, 'cli/codex-dog.exe')], { windowsHide: true, stdio: 'ignore', env: windowsPowerShellEnvironment() });
      const timer = setTimeout(() => { child.kill(); resolve(false); }, 3000);
      child.once('error', () => { clearTimeout(timer); resolve(false); }); child.once('exit', code => { clearTimeout(timer); resolve(code === 0); });
    });
    if (free) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new UpdateError('CLI_IN_USE', '请先关闭安装目录中的 CLI/MCP，再重新申请安装；未终止占用者');
}
async function stop(forUpdate = false) {
  stopping = true; router.stop();
  clearTimeout(quitTimer);
  await startupTask?.catch(() => {});
  try { if (!forUpdate) await updates.close(); }
  finally {
    try { const endpoint = JSON.parse(await readFile(paths.descriptor, 'utf8')); if (endpoint.instanceId === instanceId) await unlink(paths.descriptor); } catch { /* 只清理本实例端点。 */ }
    try { await pipe.stop(); } finally { try { await runtime.stop(); } finally { await configuration.close(); await access.close(); tray?.destroy(); tray = undefined; } }
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.on('window-all-closed', () => { if (!tray) app.quit(); });
  app.on('before-quit', event => {
    if (exitAllowed) return;
    event.preventDefault();
    stopTask ??= stop().finally(() => { exitAllowed = true; app.exit(); });
  });
  void app.whenReady().then(() => { if (stopping) return; startupTask = start(); void startupTask.catch(error => { console.error(formatStartupDiagnostic(startupStage, error?.code, error?.detail)); app.quit(); }); });
}
