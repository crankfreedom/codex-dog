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
import { stage3WorkerOperations } from '../../packages/contracts/stage3.ts';
import { SettingsService } from '../../packages/modules/settings/service.ts';
import { HistoryService } from '../../packages/modules/history/service.ts';
import { DiagnosticsService } from '../../packages/modules/diagnostics/service.ts';
import { QuotaMonitor } from '../../packages/modules/quota/monitor.ts';
import { LocalHistoryFiles,HistoryCursorCodec } from '../../packages/infrastructure/history-files.ts';
import { FixtureThreadProvider,FixtureGoalProvider } from '../../packages/infrastructure/fixture-threads.ts';
import { Stage3Registry } from '../../packages/app/stage3-registry.ts';
import { Stage3Error } from '../../packages/modules/persistence/stage3-ports.ts';
import type { ActorRef } from '../../packages/modules/persistence/stage3-ports.ts';

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
  new CodexDesktopReadonly({ callerThreadId: process.env.CODEX_DOG_CALLER, pipe: process.env.CODEX_DOG_CODEX_PIPE || undefined, timeoutMs: 15000 }),
  new CodexGoalReadonly(process.env.CODEX_DOG_CODEX_HOME || join(homedir(), '.codex')),
  { now: Date.now, newId: randomUUID, digest: value => createHash('sha256').update(value).digest('hex') }), identity) : undefined;
const registry = live ?? new ApplicationRegistry(new PersistedUsageReader(store, new FixtureUsageReader(scenario), scenario), identity);
const fixtureReadonly=mode==='fixture'?new ReadonlyRegistry(new CodexReadonlyService(new FixtureThreadProvider(),new FixtureGoalProvider(),{now:Date.now,newId:randomUUID,digest:value=>createHash('sha256').update(value).digest('hex'),source:'fixture'}),identity):undefined;
const pendingAuthorization=new Map<string,{resolve:()=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();
const authorize=(actor:ActorRef,scope:'read'|'settings.manage'='read')=>new Promise<void>((resolve,reject)=>{const id=randomUUID();const timer=setTimeout(()=>{pendingAuthorization.delete(id);reject(new Stage3Error('AUTH_REVOKED','权限复核未完成，取消操作'));},2000);pendingAuthorization.set(id,{resolve,reject,timer});parent.postMessage({type:'authorize',id,actor,scope});});
const settings=new SettingsService(store,Date.now,value=>createHash('sha256').update(value).digest('hex'));
let cursor:HistoryCursorCodec;
const history=new HistoryService(store,new LocalHistoryFiles(directory),{now:Date.now,newId:randomUUID,digest:value=>createHash('sha256').update(value).digest('hex'),encode:value=>cursor.encode(value),decode:value=>cursor.decode(value),authorize:actor=>authorize(actor),yield:()=>new Promise(resolve=>setTimeout(resolve,process.env.CODEX_DOG_TEST_HOOKS==='1'?Math.min(1000,Math.max(5,Number(process.env.CODEX_DOG_TEST_EXPORT_DELAY_MS)||5)):5))});
const monitor=new QuotaMonitor({now:Date.now,schedule:(delay,run)=>{const timer=setTimeout(run,delay);return()=>clearTimeout(timer);},refresh:async()=>{const result=await registry.invoke({apiVersion,requestId:randomUUID(),operation:mode==='live-readonly'?'quota.refresh':'quota.get',params:{}},['read']);if(!result.ok)throw new Stage3Error(result.error.code,'只读额度刷新失败');}});
const diagnostics=new DiagnosticsService({mode:()=>mode,now:Date.now,storage:()=>store.health(),connection:()=>live?.status()??{state:'fixture'},quota:()=>{if(live)return live.quota();const result=(registry as ApplicationRegistry).invoke({apiVersion,requestId:'diagnostic-snapshot',operation:'quota.get',params:{}},['read']);if(!result.ok)throw new Stage3Error(result.error.code,'额度观察不可用');return result.data;},thread:async ref=>{const result=await (live??fixtureReadonly!).invoke({apiVersion,requestId:randomUUID(),operation:'threads.get',params:ref},['read']);if(!result.ok)throw new Stage3Error(result.error.code,'目标只读失败');return result.data;}});
const stage3=new Stage3Registry({settings,history,diagnostics,monitor,identity,authorize});
const hooks = mode === 'fixture' && process.env.CODEX_DOG_TEST_HOOKS === '1';
if (hooks) probe = new G03FixtureControl(store, directory);
let blocked = false;let stopping=false;
let heartbeat = setInterval(() => parent.postMessage({ type: 'heartbeat', ...(live ? { provider: live.status() } : {}) }), 500);
const ownerPid = Number(process.env.CODEX_DOG_PARENT_PID);
if (!Number.isInteger(ownerPid) || ownerPid < 1) throw new Error('业务进程缺少主应用身份');
const ownerMonitor = setInterval(() => { try { process.kill(ownerPid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') process.exit(0); } }, 750);
parent.on('message', event => {
  const message = event.data as { type: string; id: string; request: unknown;actor?:ActorRef;allowed?:boolean;code?:string };
  if(message.type==='authorized'){const pending=pendingAuthorization.get(message.id);if(pending){clearTimeout(pending.timer);pendingAuthorization.delete(message.id);if(message.allowed)pending.resolve();else pending.reject(new Stage3Error(message.code==='APP_STOPPING'?'APP_STOPPING':'AUTH_REVOKED','操作已停止或调用方授权失效'));}return;}
  if (message.type === 'stop') { if(stopping)return;stopping=true;clearInterval(heartbeat);clearInterval(ownerMonitor);void stage3.close().finally(()=>{store.appendRuntime('runtime.stopping',mode,new Date().toISOString());registry.close();fixtureReadonly?.close();try{probe?.close();}finally{store.close();}process.exit(0);});return; }
  if (hooks && message.type === 'test:hang') { blocked = true; clearInterval(heartbeat); }
  if (hooks && message.type === 'test:exit') process.exit(23);
  if (message.type === 'invoke' && !blocked) {
    const testRequest = requestSchema.safeParse(message.request);
    if (testRequest.success && testRequest.data.operation === 'system.prepare-update') {
      const installId = testRequest.data.params.installId;
      let result;
      try {
        if (typeof installId !== 'string' || !/^[a-f0-9-]{36}$/i.test(installId)) throw new Error('更新操作标识无效');
        store.backup(join(directory, 'update-backups', installId + '.sqlite'));
        result = { ok: true, data: { backedUp: true }, meta: { apiVersion, requestId: testRequest.data.requestId, source: 'local', ...identity } };
      } catch { result = failure('STORAGE_FAILURE', '安装前一致备份失败', testRequest.data.requestId); }
      parent.postMessage({ id: message.id, result }); return;
    }
    if (hooks && testRequest.success && testRequest.data.operation === 'g03.test') {
      let result;
      try { result = { ok: true, data: probe!.execute(testRequest.data.params), meta: { apiVersion, requestId: testRequest.data.requestId, source: 'fixture', ...identity } }; }
      catch (error) { result = failure(error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'STORAGE_FAILURE', 'G03 模拟存储操作失败', testRequest.data.requestId); }
      parent.postMessage({ id: message.id, result }); return;
    }
    const send = async () => {
      if(stopping)return;
      let result;
      if(testRequest.success&&stage3WorkerOperations.has(testRequest.data.operation)){
        result=await stage3.invoke(testRequest.data,message.actor);
      }else if(mode==='fixture'&&testRequest.success&&testRequest.data.operation==='quota.refresh')result=await registry.invoke({...testRequest.data,operation:'quota.get'},['read']);
      else if(mode==='fixture'&&testRequest.success&&testRequest.data.operation!=='quota.get')result=await fixtureReadonly!.invoke(message.request,['read']);
      else result=await registry.invoke(message.request,['read']);
      parent.postMessage({ id: message.id, result, ...(live ? { provider: live.status() } : {}) });
    };
    if (hooks && process.env.CODEX_DOG_TEST_DELAY_MS) setTimeout(send, Number(process.env.CODEX_DOG_TEST_DELAY_MS)); else send();
  }
});
void (async () => { store.start();cursor=new HistoryCursorCodec(store.cursorKey());probe?.start();await registry.start();await fixtureReadonly?.start();await stage3.start();store.appendRuntime('runtime.started',mode,new Date().toISOString());parent.postMessage({ type: 'ready', ...(live ? { provider: live.status() } : {}) }); })().catch(() => { store.close(); process.exit(1); });
