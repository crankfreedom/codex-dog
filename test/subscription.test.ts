import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {access} from 'node:fs/promises';
import {HistoryService} from '../packages/modules/history/service.ts';
import {HistoryCursorCodec} from '../packages/infrastructure/history-files.ts';
import {Stage3Error} from '../packages/modules/persistence/stage3-ports.ts';
import type {Stage3StorePort,HistoryEvent,HistoryFilter} from '../packages/modules/persistence/stage3-ports.ts';
import {definitions} from '../packages/contracts/protocol.ts';
import {eventSubscribe,stage3Outputs} from '../packages/contracts/stage3.ts';
import {locations} from '../packages/infrastructure/local-transport.ts';

const actor={kind:'external' as const,clientId:randomUUID(),revision:1};
async function setup(count=5){
 const rows:HistoryEvent[]=[],pageSizes:number[]=[];let authorized=true,authorizations=0,afterPage:(()=>void)|undefined;
 const add=(type='runtime.started')=>rows.push({sequence:rows.length+1,at:'2026-11-17T00:00:00.000Z',type,reason:'fixture',source:'local',revision:null});for(let i=0;i<count;i++)add();
 const store={eventBoundary:()=>rows.length,eventPage:(filter:HistoryFilter,boundary:number,after:number,limit:number)=>{pageSizes.push(limit);const selected=rows.filter(x=>x.sequence>after&&x.sequence<=boundary&&(!filter.type||x.type===filter.type)&&(!filter.reason||x.reason===filter.reason)&&(!filter.taskId||x.resourceId===filter.taskId)).slice(0,limit).map(x=>({...x}));afterPage?.();return selected;},recoverExports:()=>[]} as unknown as Stage3StorePort;
 const codec=new HistoryCursorCodec('isolated-subscription-test-key');const history=new HistoryService(store,{start:async()=>{},recover:async()=>{},open:async()=>{throw new Error('订阅不得创建导出文件');}},{now:()=>Date.parse('2026-11-17T00:00:00Z'),newId:randomUUID,digest:x=>createHash('sha256').update(x).digest('hex'),encode:x=>codec.encode(x),decode:x=>codec.decode(x),authorize:async()=>{authorizations++;if(!authorized)throw new Stage3Error('AUTH_REVOKED','撤销');},yield:async()=>{}});await history.start();
 return {history,add,rows,pageSizes,revoke:()=>authorized=false,onPage:(fn:()=>void)=>afterPage=fn,authorizations:()=>authorizations};
}
test('订阅逐批追平固定边界，再推进新边界，游标可重放和断连恢复',async()=>{const f=await setup();try{
 const first=await f.history.subscribe({limit:2},actor);assert.deepEqual(first.items.map(x=>x.sequence),[1,2]);assert.equal(first.boundary,5);assert.equal(first.caughtUp,false);assert(stage3Outputs['events.subscribe']!.safeParse(first).success);
 f.add();f.add();const second=await f.history.subscribe({limit:2,cursor:first.nextCursor},actor);assert.deepEqual(second.items.map(x=>x.sequence),[3,4]);assert.equal(second.boundary,5);assert.equal(second.caughtUp,false);
 assert.deepEqual((await f.history.subscribe({limit:2,cursor:first.nextCursor},actor)).items,second.items);
 const third=await f.history.subscribe({limit:2,cursor:second.nextCursor},actor);assert.deepEqual(third.items.map(x=>x.sequence),[5]);assert.equal(third.caughtUp,true);assert.equal(third.boundary,5);
 const resumed=await f.history.subscribe({limit:2,cursor:third.nextCursor},actor);assert.deepEqual(resumed.items.map(x=>x.sequence),[6,7]);assert.equal(resumed.boundary,7);assert.equal(resumed.caughtUp,true);
 const empty=await f.history.subscribe({limit:2,cursor:resumed.nextCursor},actor);assert.equal(empty.items.length,0);assert.equal(empty.caughtUp,true);assert.equal(empty.nextCursor,resumed.nextCursor);
 }finally{await f.history.close();}});
test('订阅游标绑定过滤和操作，篡改或查询游标不能用于订阅',async()=>{const f=await setup();try{
 const first=await f.history.subscribe({limit:1,type:'runtime.started'},actor);
 await assert.rejects(f.history.subscribe({limit:1,type:'settings.updated',cursor:first.nextCursor},actor),{code:'INVALID_ARGUMENT'});
 await assert.rejects(f.history.subscribe({limit:1,type:'runtime.started',cursor:first.nextCursor+'x'},actor),{code:'INVALID_ARGUMENT'});
 const query=f.history.query({limit:1,type:'runtime.started'});assert(query.nextCursor);await assert.rejects(f.history.subscribe({limit:1,type:'runtime.started',cursor:query.nextCursor},actor),{code:'INVALID_ARGUMENT'});
 const skipped=await f.history.subscribe({limit:2,type:'settings.updated'},actor);assert.equal(skipped.items.length,0);assert.equal(skipped.caughtUp,true);f.add('settings.updated');const next=await f.history.subscribe({type:'settings.updated',cursor:skipped.nextCursor},actor);assert.deepEqual(next.items.map(x=>x.sequence),[6]);
 }finally{await f.history.close();}});
test('慢客户端没有宿主队列，每批读取有界，返回前撤销不会泄露已读取事件',async()=>{const f=await setup(10000);try{
 const batch=await f.history.subscribe({limit:200},actor);assert.equal(batch.items.length,200);assert.deepEqual(f.pageSizes,[201]);assert.equal(f.authorizations(),2);
 f.onPage(f.revoke);await assert.rejects(f.history.subscribe({limit:200,cursor:batch.nextCursor},actor),{code:'AUTH_REVOKED'});assert.equal(f.authorizations(),4);
 assert(!eventSubscribe.safeParse({limit:201}).success);assert(!eventSubscribe.safeParse({limit:1,follow:true}).success);assert(!eventSubscribe.safeParse({sql:'SELECT 1'}).success);
 }finally{await f.history.close();}await assert.rejects(f.history.subscribe({},actor),{code:'APP_STOPPING'});});
async function cli(args:string[],profile:string,preload?:string){return new Promise<{code:number|null;stdout:string;stderr:string}>((resolveCall,reject)=>{const child=spawn(process.execPath,[...(preload?['--import','data:text/javascript,'+encodeURIComponent(preload)]:[]),'apps/cli/main.ts',...args,'--profile',profile,'--json'],{cwd:process.cwd(),windowsHide:true,env:{...process.env,NODE_OPTIONS:''},stdio:'pipe'});let stdout='',stderr='';const timer=setTimeout(()=>{child.kill();reject(new Error('CLI 验证超时'));},15000);child.stdout.on('data',chunk=>stdout+=String(chunk));child.stderr.on('data',chunk=>stderr+=String(chunk));child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);resolveCall({code,stdout,stderr});});child.stdin.end();});}
test('CLI --follow 离线只输出一条 NDJSON 后停止，不创建 profile 或拉起应用',async()=>{const profile='subscription-'+randomUUID().slice(0,8),directory=locations(profile).directory;await assert.rejects(access(directory));const result=await cli(['events','subscribe','--follow'],profile);assert.equal(result.code,5);const lines=result.stdout.trim().split('\n');assert.equal(lines.length,1);assert.equal(JSON.parse(lines[0]!).error.code,'APP_NOT_RUNNING');await assert.rejects(access(directory));});
test('CLI stdout 写入迟迟不完成时五秒内切断订阅，不留下等待输出的进程',async()=>{const profile='subscription-'+randomUUID().slice(0,8),start=Date.now();const result=await cli(['events','subscribe','--follow'],profile,'process.stdout.write=()=>false;');assert.equal(result.code,5);assert.equal(result.stdout,'');assert.match(result.stderr,/SUBSCRIPTION_SLOW_CLIENT/);assert(Date.now()-start>=4500);assert(Date.now()-start<12000);await assert.rejects(access(locations(profile).directory));});
test('CLI --id 交由每个能力严格 Schema 校验，修订变更仍必须补齐输入',async()=>{const profile='subscription-'+randomUUID().slice(0,8),id=randomUUID();for(const operation of ['tasks.get','tasks.pause','attempts.get','archives.get','templates.get']){
 const definition=definitions.find(x=>x.operation===operation)!;const result=await cli([...definition.command,'--id',id],profile);assert.equal(result.code,5);assert.equal(JSON.parse(result.stdout).error.code,'APP_NOT_RUNNING');
 }for(const args of [['quota','get','--id',id],['tasks','update','--id',id],['templates','delete','--id',id],['events','query','--follow']]){const result=await cli(args,profile);assert.equal(result.code,2);assert.equal(JSON.parse(result.stdout).error.code,'INVALID_ARGUMENT');}await assert.rejects(access(locations(profile).directory));});
