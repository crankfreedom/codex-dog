import { randomUUID } from 'node:crypto';
import { ApplicationRegistry } from '../../packages/app/registry.ts';
import { FixtureUsageReader } from '../../packages/infrastructure/fixture-usage.ts';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { CodexDesktopReadonly } from '../../packages/infrastructure/codex-desktop-readonly.ts';
import { CodexGoalReadonly } from '../../packages/infrastructure/codex-goal-readonly.ts';
import { CodexReadonlyService } from '../../packages/modules/codex-readonly/service.ts';
import { ReadonlyRegistry } from '../../packages/app/readonly-registry.ts';
import { SqliteStore } from '../../packages/infrastructure/sqlite-store.ts';
import { PersistedUsageReader } from '../../packages/infrastructure/persisted-usage.ts';
import { G03FixtureControl } from './g03-fixture-control.ts';
import { apiVersion, failure, requestSchema } from '../../packages/contracts/protocol.ts';

const parent = process.parentPort;
if (!parent) throw new Error('业务进程必须由主应用启动');
const scenario = process.env.CODEX_DOG_FIXTURE;
if (scenario !== 'available' && scenario !== 'blocked' && scenario !== 'unknown') throw new Error('未指定合法模拟场景');
const directory = process.env.CODEX_DOG_DATA_DIRECTORY;
if (!directory) throw new Error('业务进程缺少独立数据目录');
const identity = { runtimeId: randomUUID(), handlerInstanceId: randomUUID(), workerPid: process.pid };
let probe: G03FixtureControl | undefined;
const store = new SqliteStore(join(directory, 'codex-dog.sqlite'), stage => probe?.onStep(stage));
const mode = process.env.CODEX_DOG_SOURCE ?? 'fixture';
if (mode !== 'fixture' && mode !== 'live-readonly') throw new Error('无效来源模式');
const live = mode === 'live-readonly' ? new ReadonlyRegistry(new CodexReadonlyService(
  new CodexDesktopReadonly({ callerThreadId: process.env.CODEX_DOG_CALLER, pipe: process.env.CODEX_DOG_CODEX_PIPE || undefined }),
  new CodexGoalReadonly(process.env.CODEX_DOG_CODEX_HOME || join(homedir(), '.codex')),
  { now: Date.now, newId: randomUUID, digest: value => createHash('sha256').update(value).digest('hex') }), identity) : undefined;
const registry = live ?? new ApplicationRegistry(new PersistedUsageReader(store, new FixtureUsageReader(scenario), scenario), identity);
const hooks = mode === 'fixture' && process.env.CODEX_DOG_TEST_HOOKS === '1';
if (hooks) probe = new G03FixtureControl(store, directory);
let blocked = false;
let heartbeat = setInterval(() => parent.postMessage({ type: 'heartbeat', ...(live ? { provider: live.status() } : {}) }), 500);
const ownerPid = Number(process.env.CODEX_DOG_PARENT_PID);
if (!Number.isInteger(ownerPid) || ownerPid < 1) throw new Error('业务进程缺少主应用身份');
const ownerMonitor = setInterval(() => { try { process.kill(ownerPid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') process.exit(0); } }, 750);
parent.on('message', event => {
  const message = event.data as { type: string; id: string; request: unknown };
  if (message.type === 'stop') { clearInterval(heartbeat); clearInterval(ownerMonitor); registry.close(); try { probe?.close(); } finally { store.close(); } process.exit(0); }
  if (hooks && message.type === 'test:hang') { blocked = true; clearInterval(heartbeat); }
  if (hooks && message.type === 'test:exit') process.exit(23);
  if (message.type === 'invoke' && !blocked) {
    const testRequest = requestSchema.safeParse(message.request);
    if (hooks && testRequest.success && testRequest.data.operation === 'g03.test') {
      let result;
      try { result = { ok: true, data: probe!.execute(testRequest.data.params), meta: { apiVersion, requestId: testRequest.data.requestId, source: 'fixture', ...identity } }; }
      catch (error) { result = failure(error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'STORAGE_FAILURE', 'G03 模拟存储操作失败', testRequest.data.requestId); }
      parent.postMessage({ id: message.id, result }); return;
    }
    const send = async () => { const result = await registry.invoke(message.request, ['read']); parent.postMessage({ id: message.id, result, ...(live ? { provider: live.status() } : {}) }); };
    if (hooks && process.env.CODEX_DOG_TEST_DELAY_MS) setTimeout(send, Number(process.env.CODEX_DOG_TEST_DELAY_MS)); else send();
  }
});
void (async () => { store.start(); probe?.start(); await registry.start(); parent.postMessage({ type: 'ready', ...(live ? { provider: live.status() } : {}) }); })().catch(() => { store.close(); process.exit(1); });
