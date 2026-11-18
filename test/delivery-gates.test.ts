import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,realpathSync,readFileSync,readdirSync,renameSync,mkdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {CodexTargetMetadata} from '../packages/infrastructure/codex-target-metadata.ts';
import {DeliveryGateService} from '../packages/modules/delivery/gates.ts';
import type {DeliveryGatePorts} from '../packages/modules/delivery/gates.ts';
import {DiagnosticsService} from '../packages/modules/diagnostics/service.ts';
import {deliveryGateReport} from '../packages/contracts/delivery-gates.ts';
import {sourceSelection} from '../packages/contracts/protocol.ts';
import {FileSourceStore} from '../packages/infrastructure/source-store.ts';
import {defaultSourceState} from '../packages/app/source-configuration.ts';

const thread=randomUUID(),owner='fixture-account',hash=createHash('sha256').update(owner).digest('hex');
function metadataFixture(){
 const directory=mkdtempSync(join(realpathSync.native(tmpdir()),'dog-metadata-中文 空格-'));
 const db=(file:string,sql:string,args:unknown[])=>{const d=new DatabaseSync(join(directory,file));d.exec(sql);d.prepare(file==='state_5.sqlite'?'INSERT INTO threads(id,creator_account_id) VALUES(?,?)':file==='goals_1.sqlite'?'INSERT INTO thread_goals(thread_id,goal_id,status) VALUES(?,?,?)':'INSERT INTO thread_turns(thread_id,turn_id,status,first_user_item_id,rollout_ordinal) VALUES(?,?,?,?,?)').run(...args as [string]);d.close();};
 // The adapter installs a SQLite authorizer allowing only the fixed metadata columns.
 db('state_5.sqlite',"CREATE TABLE threads(id TEXT PRIMARY KEY,creator_account_id TEXT,preview TEXT DEFAULT 'private-body',first_user_message TEXT DEFAULT 'private-first')",[thread,owner]);
 db('goals_1.sqlite',"CREATE TABLE thread_goals(thread_id TEXT,goal_id TEXT,status TEXT,objective TEXT DEFAULT 'private-objective')",[thread,'goal','active']);
 db('thread_history_1.sqlite',"CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,status TEXT,first_user_item_id TEXT,rollout_ordinal INTEGER,error_json TEXT DEFAULT 'private-error');CREATE TABLE thread_items(item_json TEXT)",[thread,'turn','completed','client-item',3]);
 return {directory,reader:new CodexTargetMetadata(directory)};
}
function ports():DeliveryGatePorts{return{source:'live',now:()=>100000,account:()=>({verified:true,stale:false,connectionId:'connection',revision:1,accountBinding:hash}),metadata:()=>({availability:'known',reason:'LOCAL_METADATA_ONLY',found:true,creatorAccountBinding:hash,goal:{availability:'known',current:{id:'goal',status:'active'}},latestTurn:{id:'turn',status:'completed',firstUserItemId:'item'}}),locks:()=>({lockAvailability:'free',reasons:[]})};}

test('SQLite 列白名单只读投影，正文/错误/Goal objective 不返回，源库字节不变且无新增文件',()=>{
 const f=metadataFixture(),files=readdirSync(f.directory),before=files.map(x=>readFileSync(join(f.directory,x)));
 const read=f.reader.read(thread);assert.equal(read.availability,'known');assert.equal(read.creatorAccountBinding,hash);assert.equal(read.goal.current!.status,'active');assert.equal(read.latestTurn!.firstUserItemId,'client-item');assert(!JSON.stringify(read).includes(owner));assert(!JSON.stringify(read).includes('private-'));
 assert.deepEqual(readdirSync(f.directory),files);files.forEach((x,i)=>assert.deepEqual(readFileSync(join(f.directory,x)),before[i]));
 assert.equal(f.reader.read(randomUUID()).reason,'TARGET_METADATA_NOT_FOUND');assert.equal(f.reader.read(thread.toUpperCase()).availability,'unknown');
});
test('缺列/损坏/目标目录替换或父 junction 不作为正常元数据',()=>{
 const f=metadataFixture();renameSync(f.directory,f.directory+'-old');mkdirSync(f.directory);assert.equal(f.reader.read(thread).availability,'unknown');
 const g=metadataFixture();assert.equal(g.reader.read(thread).availability,'known');renameSync(g.directory,g.directory+'-old');mkdirSync(g.directory);assert.equal(g.reader.read(thread).reason,'METADATA_DIRECTORY_CHANGED');
 const h=metadataFixture(),alias=h.directory+'-alias';symlinkSync(h.directory,alias,process.platform==='win32'?'junction':'dir');assert.equal(new CodexTargetMetadata(alias).read(thread).availability,'unknown');
 const d=new DatabaseSync(join(h.directory,'state_5.sqlite'));d.exec('ALTER TABLE threads RENAME COLUMN creator_account_id TO unsupported_owner');d.close();assert.equal(h.reader.read(thread).availability,'unknown');
});
test('Goal 缺失保持 unknown；没有当前 Goal 才 known/null',()=>{
 const f=metadataFixture();renameSync(join(f.directory,'goals_1.sqlite'),join(f.directory,'goals.old'));assert.equal(f.reader.read(thread).goal.availability,'unknown');
 const g=metadataFixture(),db=new DatabaseSync(join(g.directory,'goals_1.sqlite'));db.exec('DELETE FROM thread_goals');db.close();assert.deepEqual(g.reader.read(thread).goal,{availability:'known',current:null});
});
test('元数据表被 view 或生成账号字段替代时拒绝，不从正文推导身份',()=>{
 const f=metadataFixture(),db=new DatabaseSync(join(f.directory,'state_5.sqlite'));db.exec('ALTER TABLE threads RENAME TO original;CREATE VIEW threads AS SELECT id,preview AS creator_account_id FROM original');db.close();assert.equal(f.reader.read(thread).availability,'unknown');
 const g=metadataFixture(),next=new DatabaseSync(join(g.directory,'state_5.sqlite'));next.exec('ALTER TABLE threads RENAME TO original;CREATE TABLE threads(id TEXT,preview TEXT,creator_account_id TEXT GENERATED ALWAYS AS (preview) VIRTUAL)');next.prepare('INSERT INTO threads(id,preview) VALUES(?,?)').run(thread,'private');next.close();assert.equal(g.reader.read(thread).availability,'unknown');
});
test('创建账号相同、持久化轮次完成、锁快照为空仍不能放行真实发送',()=>{
 const p=ports(),report=new DeliveryGateService(p).inspect({connectionId:'connection',threadId:thread});assert(deliveryGateReport.safeParse(report).success);assert.equal(report.status,'blocked');assert.equal(report.realSendingEnabled,false);
 for(const id of ['delivery_account_observation','delivery_target_creator','delivery_turn_metadata','delivery_lock_snapshot'])assert.equal(report.checks.find(x=>x.id===id)!.status,'passed');
 for(const id of ['delivery_target_execution_binding','delivery_live_target_state','delivery_legacy_recovery'])assert.equal(report.checks.find(x=>x.id===id)!.status,'unknown');assert.equal(report.checks.find(x=>x.id==='delivery_unique_receipt')!.status,'blocked');assert(!JSON.stringify(report).includes(hash));
});
test('账号过期/连接改变、账号不符及来源异常保守阻断，不改选来源',()=>{
 for(const change of ['stale','connection','creator','metadata','lock']){const p=ports();if(change==='stale'){const a=p.account();p.account=()=>({...a,stale:true});}if(change==='creator'){const m=p.metadata(thread);p.metadata=()=>({...m,creatorAccountBinding:'other'});}if(change==='metadata')p.metadata=()=>{throw Error();};if(change==='lock')p.locks=()=>{throw Error();};const r=new DeliveryGateService(p).inspect({connectionId:change==='connection'?'other':'connection',threadId:thread});assert.equal(r.realSendingEnabled,false);assert(r.checks.some(x=>x.status==='unknown'||x.status==='blocked'));}
});
test('fixture 门禁不触碰真实端口；真实只读诊断门禁不调用会话正文 API、不刷新额度',async()=>{
 const p=ports();p.source='fixture';p.account=()=>{throw Error('must not read');};p.metadata=()=>{throw Error('must not read');};assert.equal(new DeliveryGateService(p).inspect().status,'not_checked');
 const service=new DiagnosticsService({mode:()=> 'live-readonly',quota:()=>({available:true}),connection:()=>({state:'ready'}),storage:()=>({integrity:'ok',schemaVersion:11}),thread:async()=>{throw Error('must not call');},now:()=>100000,deliveryGates:ref=>new DeliveryGateService(ports()).inspect(ref)});
 const r=await service.run({connectionId:'connection',threadId:thread},true);assert.equal(r.status,'blocked');assert.equal(r.deliveryGates!.realSendingEnabled,false);assert.equal(r.checks.find(x=>x.id==='thread')!.status,'not_checked');
});
test('来源路径为明确本机目录，拒绝 UNC/相对/设备路径；存储超限拒绝且原文件保留',async()=>{
 for(const path of ['relative','\\\\server\\share','\\\\?\\C:\\data','C:\\bad\npath','C:relative'])assert(!sourceSelection.safeParse({source:'fixture',callerThreadId:'',pipe:'',codexHome:path}).success);
 assert(sourceSelection.safeParse({source:'fixture',callerThreadId:'',pipe:'',codexHome:'C:\\资料 空格\\.codex',legacyLockDirectory:'D:\\locks'}).success);
 const dir=mkdtempSync(join(realpathSync.native(tmpdir()),'dog-source-bound-')),file=join(dir,'source.json'),store=new FileSourceStore(file),state=defaultSourceState();await store.save(state);const before=readFileSync(file);state.requests=Array.from({length:2048},(_,i)=>({key:String(i),body:'汉'.repeat(2000),result:{}}));await assert.rejects(store.save(state));assert.deepEqual(readFileSync(file),before);assert.deepEqual(readdirSync(dir),['source.json']);
});
