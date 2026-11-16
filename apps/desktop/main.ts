import { app, BrowserWindow, ipcMain, utilityProcess } from 'electron';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { writeFile, rename, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { apiVersion, failure, wireSchema } from '../../packages/contracts/protocol.ts';
import { locations } from '../../packages/infrastructure/local-transport.ts';
import { SecurePipeHost } from '../../packages/infrastructure/secure-pipe.ts';
import { FileAccessStore } from '../../packages/infrastructure/access-store.ts';
import { AccessService } from '../../packages/modules/access/service.ts';
import { WorkerSupervisor } from '../../packages/app/worker-supervisor.ts';
import { HostRouter } from '../../packages/app/router.ts';
import { seal, unseal, packetIv } from '../../packages/infrastructure/channel.ts';

const argument = (name: string, fallback: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const profile = argument('profile', 'g02');
const scenario = argument('fixture', 'available');
const sourceMode = argument('source', 'fixture');
if (sourceMode !== 'fixture' && sourceMode !== 'live-readonly') throw new Error('来源模式无效');
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
const access = new AccessService({ store: new FileAccessStore(join(paths.directory, 'access.json')), now: () => Date.now(), newCode: () => randomBytes(3).toString('hex').toUpperCase(),
  digest: value => createHash('sha256').update(value).digest('hex'), equal: (a, b) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); } });
const runtime = new WorkerSupervisor({ now: () => performance.now(), newId: randomUUID, requestTimeout: sourceMode === 'live-readonly' ? 30000 : 5000, startupTimeout: sourceMode === 'live-readonly' ? 15000 : 5000, spawn: () => {
  const child = utilityProcess.fork(join(__dirname, 'worker.cjs'), [], { serviceName: 'Codex Dog fixture worker', stdio: 'pipe', env: { ...process.env, CODEX_DOG_FIXTURE: scenario,
    CODEX_DOG_PARENT_PID: String(process.pid), CODEX_DOG_SOURCE: sourceMode, CODEX_DOG_CODEX_PIPE: argument('codex-pipe', ''), CODEX_DOG_CALLER: argument('codex-caller-thread', process.env.CODEX_THREAD_ID ?? ''), CODEX_DOG_CODEX_HOME: argument('codex-home', process.env.CODEX_HOME ?? ''), CODEX_DOG_DATA_DIRECTORY: paths.directory, CODEX_DOG_TEST_HOOKS: testHooks ? '1' : '0', CODEX_DOG_TEST_DELAY_MS: testHooks ? argument('test-delay-ms', '0') : '0' } });
  child.stderr?.on('data', () => console.error('业务进程报告错误，请查看诊断状态'));
  return { get pid() { return child.pid; }, send: value => child.postMessage(value), kill: () => { child.kill(); }, onMessage: listener => { child.on('message', listener); }, onExit: listener => { child.once('exit', listener); } };
} });
const router = new HostRouter(access, runtime, { runtimeId: instanceId, handlerInstanceId: randomUUID() }, sourceMode);
const pipe = new SecurePipeHost({ script: join(__dirname, 'windows-pipe.ps1'), pipe: paths.pipe, directory: paths.directory, failed: () => { if (!stopping) app.quit(); },
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
  const identity = await pipe.start(); ownerSid = identity.ownerSid;
  if (!identity.rootProtected || !identity.pipeSddl.includes(ownerSid) || !identity.pipeSddl.includes('NU')) throw new Error('Windows ACL 校验失败');
  if (stopping) throw new Error('启动已取消');
  await access.start();
  if (stopping) throw new Error('启动已取消');
  await runtime.start();
  if (stopping) throw new Error('启动已取消');
  initialized = true;
  await writeFile(paths.descriptor + '.tmp', JSON.stringify({ apiVersion, pipe: paths.pipe, appPid: process.pid, instanceId, ownerSid, brokerPid: identity.pid, transportKey }), { mode: 0o600 });
  await rename(paths.descriptor + '.tmp', paths.descriptor);
  if (stopping) throw new Error('启动已取消');
  window = new BrowserWindow({ width: 900, height: 750, title: 'Codex Dog · G04 只读验证', webPreferences: { preload: join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, additionalArguments: testHooks ? ['--g03-test-hooks'] : [] } });
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
}
async function stop() {
  stopping = true; router.stop();
  await startupTask?.catch(() => {});
  try { const endpoint = JSON.parse(await readFile(paths.descriptor, 'utf8')); if (endpoint.instanceId === instanceId) await unlink(paths.descriptor); } catch { /* 只清理本实例端点。 */ }
  await pipe.stop(); await runtime.stop(); await access.close();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (exitAllowed) return;
    event.preventDefault();
    stopTask ??= stop().finally(() => { exitAllowed = true; app.exit(); });
  });
  void app.whenReady().then(() => { if (stopping) return; startupTask = start(); void startupTask.catch(() => { console.error('应用启动失败，拒绝开放本机服务'); app.quit(); }); });
}
