import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,readdir,writeFile,symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { SqliteStore,currentSchema } from '../packages/infrastructure/sqlite-store.ts';
import { SettingsService } from '../packages/modules/settings/service.ts';
import { HistoryService } from '../packages/modules/history/service.ts';
import { LocalHistoryFiles,HistoryCursorCodec } from '../packages/infrastructure/history-files.ts';
import { DiagnosticsService } from '../packages/modules/diagnostics/service.ts';
import { QuotaMonitor } from '../packages/modules/quota/monitor.ts';
import { AppearancePreview } from '../packages/app/appearance-preview.ts';
import { Stage3Error } from '../packages/modules/persistence/stage3-ports.ts';
import { defaultAppearance,defaultMonitoring,settingsUpdate,themeIds } from '../packages/contracts/stage3.ts';
import { readStaticHelp } from '../packages/contracts/help.ts';
import { definitions,mcpInputSchema } from '../packages/contracts/protocol.ts';
import { DatabaseSync } from 'node:sqlite';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const actor={kind:'external' as const,clientId:randomUUID(),revision:1};
const code=(expected:string)=>(error:unknown)=>!!error&&typeof error==='object'&&'code'in error&&error.code===expected;
async function setup(){const directory=await mkdtemp(join(tmpdir(),'dog-stage3-'));const store=new SqliteStore(join(directory,'app.sqlite'));store.start();const settings=new SettingsService(store,Date.now,digest);settings.start();const codec=new HistoryCursorCodec(store.cursorKey());let authorized=true;const history=new HistoryService(store,new LocalHistoryFiles(directory),{now:Date.now,newId:randomUUID,digest,encode:value=>codec.encode(value),decode:value=>codec.decode(value),authorize:async()=>{if(!authorized)throw new Stage3Error('AUTH_REVOKED','已撤销');},yield:()=>new Promise(resolve=>setTimeout(resolve,3))});await history.start();return {directory,store,settings,history,revoke:()=>{authorized=false;},close:async()=>{await history.close();store.close();}};}
async function until(check:()=>boolean){for(let i=0;i<500;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,3));}throw new Error('等待操作完成超时');}
test('设置构造无 I/O，白名单及字号范围、二十种主题均有实际契约',()=>{
  let calls=0;new SettingsService({readSetting(){calls++;throw new Error();},commitSetting(){calls++;throw new Error();}},Date.now,digest);assert.equal(calls,0);assert.equal(themeIds.length,20);
  for(const patch of [{titleSize:23},{bodySize:25},{theme:'url(http://invalid)'},{font:'arbitrary'},{lineHeight:3},{sql:'UPDATE'}])assert(!settingsUpdate.safeParse({section:'appearance',expectedRevision:1,patch}).success);
  assert(!settingsUpdate.safeParse({section:'queue',expectedRevision:1,patch:{enabled:true}}).success);
});
test('Schema 2 到 3 迁移失败整体回滚，原模拟真值保留，重试后得到完整新结构',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'dog-stage3-migration-')),path=join(directory,'app.sqlite');let store=new SqliteStore(path);store.start();store.createFixtureTask({id:'old-task',target:'fixture-migration',revision:1,count:0,maxCount:3});store.close();
  const old=new DatabaseSync(path);old.exec('DROP TABLE fixture_card_receipts;DROP TABLE fixture_delivery_receipts;DROP TABLE automation_state;DROP TABLE app_settings;DROP TABLE app_setting_operations;DROP TABLE app_events;DROP TABLE app_history_meta;DROP TABLE app_exports;DROP TABLE app_export_cancellations;PRAGMA user_version=2;');old.close();
  assert.throws(()=>new SqliteStore(path,stage=>{if(stage==='migration:3')throw new Error('迁移失败');}).start());
  const inspect=new DatabaseSync(path,{readOnly:true});assert.equal(inspect.prepare('PRAGMA user_version').get()!.user_version,2);assert.equal(inspect.prepare("SELECT count(*) n FROM sqlite_master WHERE name='app_settings'").get()!.n,0);assert.equal(inspect.prepare('SELECT count FROM fixture_tasks WHERE id=?').get('old-task')!.count,0);inspect.close();
  store=new SqliteStore(path);store.start();try{assert.equal(store.health().schemaVersion,currentSchema);assert.equal((store.snapshot().tasks as Array<{id:string}>)[0]!.id,'old-task');assert.deepEqual(store.readSetting('appearance').values,defaultAppearance);}finally{store.close();}
});
test('损坏的设置内容失败关闭，不以默认值覆盖原记录',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'dog-stage3-corrupt-')),path=join(directory,'app.sqlite');let store=new SqliteStore(path);store.start();store.close();const writer=new DatabaseSync(path);const invalid=JSON.stringify({...defaultAppearance,bodySize:999});writer.prepare('UPDATE app_settings SET payload=? WHERE section=?').run(invalid,'appearance');writer.close();store=new SqliteStore(path);store.start();try{assert.throws(()=>new SettingsService(store,Date.now,digest).start(),code('STORAGE_FAILURE'));assert.equal(store.readSetting('appearance').values.bodySize,999);}finally{store.close();}
});
test('设置分区独立修订、持久同键回放，旧修订/异参拒绝，事务失败不改设置或事件',async()=>{
  const f=await setup();try{
    const input={section:'appearance',expectedRevision:1,patch:{bodySize:18}};const saved=f.settings.update(input,actor.clientId,'a',()=>{});assert.equal(saved.revision,2);assert.equal(f.settings.get('monitoring').revision,1);
    f.settings.update({section:'monitoring',expectedRevision:1,patch:{quotaIntervalSeconds:10}},actor.clientId,'m',()=>{});assert.equal(f.settings.get('appearance').values.bodySize,18);
    assert.deepEqual(f.settings.update(input,actor.clientId,'a',()=>{}),saved);assert.throws(()=>f.settings.update({...input,patch:{bodySize:19}},actor.clientId,'a',()=>{}),code('IDEMPOTENCY_CONFLICT'));assert.throws(()=>f.settings.update(input,actor.clientId,'b',()=>{}),code('REVISION_CONFLICT'));
    assert.throws(()=>f.settings.update({section:'appearance',expectedRevision:2,patch:{bodySize:19}},actor.clientId,'revoked',()=>{throw new Stage3Error('AUTH_REVOKED','撤销');}),code('AUTH_REVOKED'));
    const before=f.store.eventBoundary();f.store.close();const reloaded=new SqliteStore(join(f.directory,'app.sqlite'));reloaded.start();const service=new SettingsService(reloaded,Date.now,digest);assert.deepEqual(service.update(input,actor.clientId,'a',()=>{}),saved);assert.equal(reloaded.eventBoundary(),before);reloaded.close();
  }finally{await f.close();}
  const directory=await mkdtemp(join(tmpdir(),'dog-setting-fault-'));const store=new SqliteStore(join(directory,'db'),stage=>{if(stage==='settings:commit')throw new Error('fault');});store.start();try{const service=new SettingsService(store,Date.now,digest);assert.throws(()=>service.update({section:'appearance',expectedRevision:1,patch:{bodySize:20}},'a','k',()=>{}));assert.deepEqual(service.get('appearance').values,defaultAppearance);assert.equal(store.eventBoundary(),0);}finally{store.close();}
});
test('历史翻页绑定条件和固定边界，新事件不挤入既有分页；篡改游标拒绝',async()=>{
  const f=await setup();try{for(let i=0;i<8;i++)f.store.appendRuntime('runtime.started','fixture',new Date().toISOString());const first=f.history.query({limit:3});assert(first.nextCursor);f.store.appendRuntime('runtime.started','fixture',new Date().toISOString());const second=f.history.query({limit:3,cursor:first.nextCursor});const third=f.history.query({limit:3,cursor:second.nextCursor!});assert.deepEqual([...first.items,...second.items,...third.items].map(x=>x.sequence),[1,2,3,4,5,6,7,8]);assert.equal(third.nextCursor,null);assert.throws(()=>f.history.query({limit:3,cursor:first.nextCursor,type:'settings.updated'}),code('INVALID_ARGUMENT'));assert.throws(()=>f.history.query({cursor:first.nextCursor+'0'}),code('INVALID_ARGUMENT'));}finally{await f.close();}
});
test('导出固定快照、本人所有权、持久幂等、文件名限制及不覆盖既有文件',async()=>{
  const f=await setup();try{
    for(let i=0;i<8;i++)f.store.appendRuntime('runtime.started','fixture',new Date().toISOString());const operation=await f.history.export({output:'history.jsonl'},actor,'export');f.store.appendRuntime('runtime.started','fixture',new Date().toISOString());
    await until(()=>f.history.get(operation.id,actor.clientId).state==='succeeded');const lines=(await readFile(join(f.directory,'exports/history.jsonl'),'utf8')).trim().split('\n').map(x=>JSON.parse(x));assert.equal(lines.length,8);assert(lines.every(x=>!('payload'in x)&&!('actor'in x)));assert.equal((await f.history.export({output:'history.jsonl'},actor,'export')).id,operation.id);
    assert.throws(()=>f.history.get(operation.id,'other'),code('OPERATION_NOT_FOUND'));await assert.rejects(f.history.export({output:'other.jsonl'},actor,'export'),code('IDEMPOTENCY_CONFLICT'));await assert.rejects(f.history.export({output:'../escape.jsonl'},actor,'bad'),code('INVALID_ARGUMENT'));
    const second=await f.history.export({output:'history.jsonl'},actor,'new');await until(()=>f.history.get(second.id,actor.clientId).state==='failed');assert.equal(f.history.get(second.id,actor.clientId).error,'EXPORT_TARGET_EXISTS');assert.equal((await readdir(join(f.directory,'exports'))).length,1);
  }finally{await f.close();}
});
test('导出取消、撤销及退出都清理临时文件，取消键不能跨操作重用',async()=>{
  for(const action of ['cancel','revoke','stop']){const f=await setup();try{for(let i=0;i<500;i++)f.store.appendRuntime('runtime.started','fixture',new Date().toISOString());const operation=await f.history.export({output:'cancelled.jsonl'},actor,'one');if(action==='cancel'){await f.history.cancel(operation.id,actor,'cancel');}else if(action==='revoke')f.revoke();else await f.history.close();await until(()=>['cancelled','failed'].includes(f.history.get(operation.id,actor.clientId).state));assert.equal(f.history.get(operation.id,actor.clientId).state,'cancelled');assert.deepEqual(await readdir(join(f.directory,'exports')),[]);if(action==='cancel'){const another=await f.history.export({},actor,'two');await assert.rejects(f.history.cancel(another.id,actor,'cancel'),code('IDEMPOTENCY_CONFLICT'));}}finally{await f.close();}}
});
test('崩溃发生在文件发布与完成记录之间，重启按硬链接身份清理本操作而保留其他文件',async()=>{
  const f=await setup();try{const id=randomUUID();f.store.createExport({id,actor,key:'crash',digest:'x',at:new Date().toISOString(),boundary:0,targetName:'crash.jsonl'});const files=new LocalHistoryFiles(f.directory);const sink=await files.open(id,'crash.jsonl');await sink.append('{}\n');await sink.publish();await writeFile(join(f.directory,'exports/unrelated.jsonl'),'keep');await files.recover(f.store.recoverExports(new Date().toISOString()));assert.equal(f.history.get(id,actor.clientId).error,'PROCESS_INTERRUPTED');assert.deepEqual(await readdir(join(f.directory,'exports')),['unrelated.jsonl']);}finally{await f.close();}
});
test('导出目录为 junction/symlink 时失败关闭，不写外部目录',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dog-export-link-')),outside=await mkdtemp(join(tmpdir(),'dog-export-outside-'));await symlink(outside,join(root,'exports'),process.platform==='win32'?'junction':'dir');await assert.rejects(new LocalHistoryFiles(root).start(),code('STORAGE_FAILURE'));assert.deepEqual(await readdir(outside),[]);
});
test('只读诊断不刷新或改计划，缺目标/Goal 不冒充检查通过，耗尽和未知分开',async()=>{
  let reads=0;const make=(available:boolean|null,stale=false)=>new DiagnosticsService({mode:()=> 'live-readonly',now:()=>0,quota:()=>{reads++;return {available,stale,reason:'quota_test'};},connection:()=>({state:'ready'}),storage:()=>({integrity:'ok',schemaVersion:3}),thread:async()=>({statusKnown:true,goal:{availability:'unknown',current:null}})});
  const blocked=await make(false).run();assert.equal(blocked.status,'blocked');assert.equal(blocked.checks.find(x=>x.id==='goal')!.status,'not_checked');assert.equal((await make(null).run()).status,'unknown');assert.equal((await make(true,true).run()).status,'unknown');const targeted=await make(true).run({connectionId:randomUUID(),threadId:randomUUID()});assert.equal(targeted.checks.find(x=>x.id==='goal')!.status,'unknown');assert.equal(reads,4);assert.equal(targeted.completionConfirmed,false);
});
test('额度监控显式 start/configure，只有只读 refresh，关闭和配置变更取消排队周期',async()=>{
  let callback:(()=>void)|undefined,cancelled=0,reads=0;const monitor=new QuotaMonitor({now:()=>0,refresh:async()=>{reads++;},schedule:(_delay,run)=>{callback=run;return()=>{cancelled++;};}});assert.equal(callback,undefined);monitor.start(defaultMonitoring);assert.equal(callback,undefined);monitor.configure({autoRefresh:true,quotaIntervalSeconds:10});const cancelledBefore=cancelled;monitor.configure({autoRefresh:true,quotaIntervalSeconds:10});assert.equal(cancelled,cancelledBefore,'同策略重放不能推迟刷新周期');callback!();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(reads,1);monitor.close();callback!();assert.equal(reads,1);assert(cancelled>0);assert.equal(monitor.status().nextCheckAt,null);
});
test('外观预览独立于持久设置，离页/隐藏可撤销，所有权和无窗口失败明确',async()=>{
  let visible=true,applied=defaultAppearance;const saved={section:'appearance' as const,revision:1,values:{...defaultAppearance}};const controller=new AppearancePreview({read:async()=>structuredClone(saved),visible:()=>visible,newId:randomUUID,apply:value=>{applied=value;}});
  const preview=await controller.preview({expectedRevision:1,patch:{bodySize:20}},actor,'preview',()=>{});assert.equal(applied.bodySize,20);assert.equal(saved.values.bodySize,defaultAppearance.bodySize);assert.deepEqual(await controller.preview({expectedRevision:1,patch:{bodySize:20}},actor,'preview',()=>{}),preview);
  assert.throws(()=>controller.cancel(preview.previewId,{...actor,clientId:randomUUID()},()=>{}),code('PERMISSION_DENIED'));controller.clear();assert.deepEqual(applied,defaultAppearance);assert.equal((await controller.preview({expectedRevision:1,patch:{bodySize:20}},actor,'preview',()=>{})).active,false);
  visible=false;await assert.rejects(controller.preview({expectedRevision:1,patch:{bodySize:20}},actor,'hidden',()=>{}),code('WINDOW_UNAVAILABLE'));
});
test('静态帮助不冒充宿主能力，MCP 分区联合 Schema 保留 object 根和幂等键',()=>{
  assert.equal(readStaticHelp('help.get',{topic:'limits'}).hostStateIncluded,false);assert((readStaticHelp('help.search',{query:'导出'}) as {items:unknown[]}).items.length>0);const schema=mcpInputSchema('settings.update')!;assert.equal(schema.type,'object');assert(schema.anyOf||schema.oneOf);assert.equal(new Set(definitions.map(x=>x.tool)).size,definitions.length);assert(definitions.length>=42);
});
