import {AppServerCards} from '../../packages/infrastructure/app-server-cards.ts';
import {OperationService} from '../../packages/modules/operations/service.ts';
import {notificationOperations} from '../../packages/contracts/notifications.ts';
import {NotificationService} from '../../packages/modules/notifications/service.ts';
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
import { SqliteStore,currentSchema } from '../../packages/infrastructure/sqlite-store.ts';
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
import { automationOperations } from '../../packages/contracts/automation.ts';
import type { AutomationScope,AutomationPorts } from '../../packages/modules/automation/ports.ts';
import { AutomationError } from '../../packages/modules/automation/ports.ts';
import { TemplateService } from '../../packages/modules/templates/service.ts';
import { TaskService } from '../../packages/modules/tasks/service.ts';
import { AutomationRegistry } from '../../packages/app/automation-registry.ts';
import {deliveryOperations} from '../../packages/contracts/delivery.ts';
import type {DeliveryPorts} from '../../packages/modules/automation/ports.ts';
import {DeliveryService} from '../../packages/modules/delivery/service.ts';
import {SchedulerService} from '../../packages/modules/scheduler/service.ts';
import {FixtureDelivery} from '../../packages/infrastructure/fixture-delivery.ts';
import {TargetLeaseAdapter} from '../../packages/infrastructure/target-lease.ts';
import type {TargetLease} from '../../packages/infrastructure/target-lease.ts';
import {cardOperations} from '../../packages/contracts/cards.ts';
import {CardService} from '../../packages/modules/cards/service.ts';
import {FixtureCards} from '../../packages/infrastructure/fixture-cards.ts';
import {DeliveryGateService} from '../../packages/modules/delivery/gates.ts';
import {CodexTargetMetadata} from '../../packages/infrastructure/codex-target-metadata.ts';
import {LegacyLockGate} from '../../packages/infrastructure/legacy-lock-gate.ts';

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
const fixtureReadonly=mode==='fixture'?new ReadonlyRegistry(new CodexReadonlyService(new FixtureThreadProvider(id=>store.fixtureLatestDelivery(id)),new FixtureGoalProvider(id=>store.fixtureLatestDelivery(id)),{now:Date.now,newId:randomUUID,digest:value=>createHash('sha256').update(value).digest('hex'),source:'fixture'}),identity):undefined;
const metadata=new CodexTargetMetadata(process.env.CODEX_DOG_CODEX_HOME||join(homedir(),'.codex')),lockGate=new LegacyLockGate();
const deliveryGates=new DeliveryGateService({source:mode==='fixture'?'fixture':'live',now:Date.now,account:()=>live!.accountObservation(),metadata:id=>metadata.read(id),locks:targetId=>process.env.CODEX_DOG_LEGACY_LOCK_DIRECTORY?lockGate.inspect({directory:process.env.CODEX_DOG_LEGACY_LOCK_DIRECTORY,targetId}):null});
const pendingAuthorization=new Map<string,{resolve:()=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();
const authorize=(actor:ActorRef,scope:AutomationScope='read')=>new Promise<void>((resolve,reject)=>{const id=randomUUID();const timer=setTimeout(()=>{pendingAuthorization.delete(id);reject(new Stage3Error('AUTH_REVOKED','权限复核未完成，取消操作'));},2000);pendingAuthorization.set(id,{resolve,reject,timer});parent.postMessage({type:'authorize',id,actor,scope});});
const automationPorts:AutomationPorts={now:Date.now,newId:randomUUID,digest:value=>createHash('sha256').update(value).digest('hex'),authorize,observe:async ref=>{
  if(live)throw new AutomationError('TARGET_BINDING_UNVERIFIED','真实自动化缺少源端无正文实时状态与执行绑定，停止目标读取');
  const service=live??fixtureReadonly!;const result=await service.invoke({apiVersion,requestId:randomUUID(),operation:'threads.get',params:ref},['read']);
  if(!result.ok)throw new AutomationError(result.error.code,'目标核验失败');
  const data=result.data,goal=data.goal as {availability:string;current:{id:string;status:string}|null},turn=data.latestTurn as {id:string;status:string}|null;
  return {binding:{connectionRevision:Number(data.connectionRevision),accountBinding:mode==='fixture'?'fixture-only':'unverified',goalId:goal.current?.id??null,latestTurnId:turn?.id??null},known:data.statusKnown===true,idle:data.status==='idle',approval:(data.activeFlags as string[]).length>0,goalKnown:goal.availability==='known',completionConfirmed:mode==='fixture'&&goal.current?.status==='complete'&&turn?.status==='completed'&&data.status==='idle',source:mode==='fixture'?'fixture':'live',reason:mode==='fixture'?'fixture_only':'binding_unverified'};
}};
const lease=new TargetLeaseAdapter(mode==='fixture'?{directory:join(directory,'fixture-target-locks'),verified:true}:undefined),fixtureDelivery=new FixtureDelivery(store,mode==='fixture'&&process.env.CODEX_DOG_TEST_HOOKS==='1'&&process.env.CODEX_DOG_TEST_DELIVERY_LOSS==='1');
const deliveryPorts:DeliveryPorts={...automationPorts,lease:{acquire:target=>lease.acquire(target),assertOwned:value=>lease.assertOwned(value as TargetLease),release:value=>lease.release(value as TargetLease),releaseRecorded:value=>lease.releaseRecorded(value as TargetLease)},quota:async()=>{const result=await registry.invoke({apiVersion,requestId:randomUUID(),operation:mode==='fixture'?'quota.get':'quota.refresh',params:{}},['read']);if(!result.ok)throw new AutomationError(result.error.code,'额度刷新失败');return {available:result.data.available as boolean|null,stale:result.data.stale===true};},eligibility:async ref=>{const result=await (live??fixtureReadonly!).invoke({apiVersion,requestId:randomUUID(),operation:'threads.get',params:ref},['read']);if(!result.ok)throw new AutomationError(result.error.code,'任务轮次读取失败');return {quotaError:result.data.latestTurnQuotaError===true,latestTurnId:(result.data.latestTurn as {id:string}|null)?.id??null,goalActive:!!(result.data.goal as {current:unknown}).current};},dispatch:(attempt,guard)=>fixtureDelivery.dispatch(attempt,guard),receipt:attempt=>fixtureDelivery.receipt(attempt)};
automationPorts.quota=deliveryPorts.quota;
if(live)automationPorts.deliveryGates=ref=>deliveryGates.inspect(ref);
automationPorts.peekQuota=()=>{if(live){const data=live.quota();return {available:data.available as boolean|null,stale:data.stale===true};}const result=(registry as ApplicationRegistry).invoke({apiVersion,requestId:'automation-diagnostic-snapshot',operation:'quota.get',params:{}},['read']);if(result instanceof Promise)throw new AutomationError('APP_NOT_READY','请使用当前只读快照');if(!result.ok)throw new AutomationError(result.error.code,'额度快照未知');return {available:result.data.available as boolean|null,stale:result.data.stale===true};};
const delivery=new DeliveryService(store,deliveryPorts),scheduler=new SchedulerService(store,automationPorts,delivery,(delay,run)=>{const timer=setTimeout(run,delay);return()=>clearTimeout(timer);});
const cardProvider=mode==='fixture'?new FixtureCards(store,Date.now,process.env.CODEX_DOG_TEST_HOOKS==='1'&&process.env.CODEX_DOG_TEST_CARD_LOSS==='1'):process.env.CODEX_DOG_CARD_EXECUTABLE?new AppServerCards({executable:process.env.CODEX_DOG_CARD_EXECUTABLE}):{read:async()=>{throw new AutomationError('CAPABILITY_UNSUPPORTED','真实卡片来源尚未显式配置');},consume:async()=>({outcome:'not_written' as const}),reconcile:async()=>({outcome:'not_written' as const}),close:async()=>{}};
const cards=new CardService(store,automationPorts,cardProvider,(delay,run)=>{const timer=setTimeout(run,delay);return()=>clearTimeout(timer);},()=>process.env.CODEX_DOG_ALLOW_CARD_CONSUMPTION==='1');
const notifications=new NotificationService(store,automationPorts,kind=>parent.postMessage({type:'notification',kind}),(delay,run)=>{const timer=setTimeout(run,delay);return()=>clearTimeout(timer);});
const automation=new AutomationRegistry(new TemplateService(store,automationPorts),new TaskService(store,automationPorts),identity,delivery,scheduler,cards,notifications,new OperationService(store,automationPorts));
const settings=new SettingsService(store,Date.now,value=>createHash('sha256').update(value).digest('hex'));
let cursor:HistoryCursorCodec;
const history=new HistoryService(store,new LocalHistoryFiles(directory),{now:Date.now,newId:randomUUID,digest:value=>createHash('sha256').update(value).digest('hex'),encode:value=>cursor.encode(value),decode:value=>cursor.decode(value),authorize:actor=>authorize(actor),yield:()=>new Promise(resolve=>setTimeout(resolve,process.env.CODEX_DOG_TEST_HOOKS==='1'?Math.min(1000,Math.max(5,Number(process.env.CODEX_DOG_TEST_EXPORT_DELAY_MS)||5)):5))});
const monitor=new QuotaMonitor({now:Date.now,schedule:(delay,run)=>{const timer=setTimeout(run,delay);return()=>clearTimeout(timer);},refresh:async()=>{const result=await registry.invoke({apiVersion,requestId:randomUUID(),operation:mode==='live-readonly'?'quota.refresh':'quota.get',params:{}},['read']);if(!result.ok)throw new Stage3Error(result.error.code,'只读额度刷新失败');}});
const diagnostics=new DiagnosticsService({deliveryGates:ref=>deliveryGates.inspect(ref),mode:()=>mode,now:Date.now,storage:()=>store.health(),connection:()=>live?.status()??{state:'fixture'},quota:()=>{if(live)return live.quota();const result=(registry as ApplicationRegistry).invoke({apiVersion,requestId:'diagnostic-snapshot',operation:'quota.get',params:{}},['read']);if(!result.ok)throw new Stage3Error(result.error.code,'额度观察不可用');return result.data;},thread:async ref=>{const result=await (live??fixtureReadonly!).invoke({apiVersion,requestId:randomUUID(),operation:'threads.get',params:ref},['read']);if(!result.ok)throw new Stage3Error(result.error.code,'目标只读失败');return result.data;}});
const stage3=new Stage3Registry({settings,history,diagnostics,monitor,identity,authorize});
const hooks = mode === 'fixture' && process.env.CODEX_DOG_TEST_HOOKS === '1';
if (hooks) probe = new G03FixtureControl(store, directory);
let blocked = false;let stopping=false;
let heartbeat = setInterval(() => parent.postMessage({ type: 'heartbeat', ...(live ? { provider: live.status() } : {}) }), 500);
const ownerPid = Number(process.env.CODEX_DOG_PARENT_PID);
if (!Number.isInteger(ownerPid) || ownerPid < 1) throw new Error('业务进程缺少主应用身份');
const ownerMonitor = setInterval(() => { try { process.kill(ownerPid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') process.exit(0); } }, 750);
parent.on('message', async event => {
  const message = event.data as { type: string; id: string; request: unknown;actor?:ActorRef;allowed?:boolean;code?:string };
  if(message.type==='authorized'){const pending=pendingAuthorization.get(message.id);if(pending){clearTimeout(pending.timer);pendingAuthorization.delete(message.id);if(message.allowed)pending.resolve();else pending.reject(new Stage3Error(message.code==='APP_STOPPING'?'APP_STOPPING':message.code==='PERMISSION_DENIED'?'PERMISSION_DENIED':'AUTH_REVOKED','操作已停止或调用方授权失效'));}return;}
  if(message.type==='environment:suspend'){automation.suspend();return;}
  if(message.type==='environment:resume'){automation.resume();return;}
  if (message.type === 'stop') { if(stopping)return;stopping=true;clearInterval(heartbeat);clearInterval(ownerMonitor);void automation.close().then(()=>stage3.close()).finally(()=>{store.appendRuntime('runtime.stopping',mode,new Date().toISOString());registry.close();fixtureReadonly?.close();try{probe?.close();}finally{store.close();}process.exit(0);});return; }
  if (hooks && message.type === 'test:hang') { blocked = true; clearInterval(heartbeat); }
  if (hooks && message.type === 'test:exit') process.exit(23);
  if (message.type === 'invoke' && !blocked) {
    const testRequest = requestSchema.safeParse(message.request);
    if(testRequest.success&&testRequest.data.operation==='system.cancel-prepare-update'){automation.resume();parent.postMessage({id:message.id,result:{ok:true,data:{resumed:true},meta:{apiVersion,requestId:testRequest.data.requestId,source:'local',...identity}}});return;}
    if (testRequest.success && testRequest.data.operation === 'system.prepare-update') {
      const installId = testRequest.data.params.installId;
      let result;
      try {
        if (typeof installId !== 'string' || !/^[a-f0-9-]{36}$/i.test(installId)) throw new Error('更新操作标识无效');
        await automation.prepareUpdate();store.backup(join(directory, 'update-backups', installId + '.sqlite'));
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
      if(testRequest.success&&(automationOperations.has(testRequest.data.operation)||deliveryOperations.has(testRequest.data.operation)||cardOperations.has(testRequest.data.operation)||notificationOperations.has(testRequest.data.operation)))result=await automation.invoke(testRequest.data,message.actor);
      else if(testRequest.success&&message.actor&&['operations.get','operations.cancel'].includes(testRequest.data.operation)&&automation.hasOperation(String(testRequest.data.params.id),message.actor))result=await automation.invoke(testRequest.data,message.actor);
      else if(testRequest.success&&stage3WorkerOperations.has(testRequest.data.operation)){
        result=await stage3.invoke(testRequest.data,message.actor);if(result.ok&&message.actor&&testRequest.data.operation==='operations.list'){const items=[...(result.data.items as Record<string,unknown>[]),...automation.listOperations(message.actor,Number(testRequest.data.params.limit??20))].sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,Number(testRequest.data.params.limit??20));result={...result,data:{items}};}
      }else if(mode==='fixture'&&testRequest.success&&testRequest.data.operation==='quota.refresh')result=await registry.invoke({...testRequest.data,operation:'quota.get'},['read']);
      else if(mode==='fixture'&&testRequest.success&&testRequest.data.operation!=='quota.get')result=await fixtureReadonly!.invoke(message.request,['read']);
      else result=await registry.invoke(message.request,['read']);
      parent.postMessage({ id: message.id, result, ...(live ? { provider: live.status() } : {}) });
    };
    if (hooks && process.env.CODEX_DOG_TEST_DELAY_MS) setTimeout(send, Number(process.env.CODEX_DOG_TEST_DELAY_MS)); else send();
  }
});
void (async () => { store.start();cursor=new HistoryCursorCodec(store.cursorKey());probe?.start();await registry.start();await fixtureReadonly?.start();await stage3.start();if(mode==='fixture')lease.start();automation.start();store.appendRuntime('runtime.started',mode,new Date().toISOString());parent.postMessage({ type: 'ready',schemaVersion:currentSchema, ...(live ? { provider: live.status() } : {}) }); })().catch(() => { store.close(); process.exit(1); });
