import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {SqliteStore} from '../packages/infrastructure/sqlite-store.ts';
import {DeliveryService} from '../packages/modules/delivery/service.ts';
import {TaskService} from '../packages/modules/tasks/service.ts';
import {SchedulerService} from '../packages/modules/scheduler/service.ts';
import {inWindow} from '../packages/modules/automation/policy.ts';
import {AutomationError} from '../packages/modules/automation/ports.ts';
import type {DeliveryPorts} from '../packages/modules/automation/ports.ts';
import {taskConfigSchema} from '../packages/contracts/automation.ts';
const actor={kind:'external' as const,clientId:randomUUID(),revision:1};
function setup(){
 const dir=mkdtempSync(join(tmpdir(),'dog-delivery-')),store=new SqliteStore(join(dir,'data.sqlite'));store.start();let now=Date.now(),writes=0,mode='ok',revoked=false,turn='turn-1',matched=false,finished=false,goalComplete=false;const held=new Set<string>();
 const ports:DeliveryPorts={now:()=>now,newId:randomUUID,digest:x=>createHash('sha256').update(x).digest('hex'),authorize:async()=>{if(revoked)throw new AutomationError('AUTH_REVOKED','revoked');},observe:async()=>({binding:{connectionRevision:1,accountBinding:'account',goalId:null,latestTurnId:turn},known:true,idle:true,approval:false,goalKnown:true,completionConfirmed:false,source:'fixture',reason:'fixture'}),quota:async()=>({available:true,stale:false}),eligibility:async()=>({quotaError:true,latestTurnId:turn,goalActive:false}),lease:{acquire(target){if(held.has(target))throw new AutomationError('TARGET_BUSY','busy');held.add(target);return {target,token:randomUUID(),pid:process.pid};},assertOwned(lease){assert(held.has(lease.target));},release(lease){held.delete(lease.target);}},dispatch:async(_attempt,guard)=>{try{await guard();}catch{return {outcome:'not_written',turnId:null};}writes++;return {outcome:mode==='lost'?'uncertain':'submitted',turnId:mode==='lost'?null:'sent-turn'};},receipt:async()=>({matched,turnId:matched?'sent-turn':null,turnFinished:finished,goalComplete})};
 const delivery=new DeliveryService(store,ports);delivery.start();const tasks=new TaskService(store,ports),scheduler=new SchedulerService(store,ports,delivery,()=>()=>{});scheduler.start();
 return {dir,store,ports,delivery,tasks,scheduler,ref:{connectionId:randomUUID(),threadId:randomUUID()},writes:()=>writes,setMode:(x:string)=>mode=x,revoke:()=>revoked=true,setTurn:(x:string)=>turn=x,setReceipt:(m:boolean,f:boolean,g=false)=>{matched=m;finished=f;goalComplete=g;},advance:(ms:number)=>now+=ms,close:async()=>{await scheduler.close();await delivery.close();store.close();rmSync(dir,{recursive:true,force:true});}};
}
test('真实门禁任务诊断复用元数据报告，不调用实时会话 API、不写调度真值',async()=>{const f=setup();try{const task=await f.tasks.invoke('tasks.create',{threadRef:f.ref,prompt:'只用于隔离诊断',mode:'observe',enabled:false},actor,'gate-task');const before=f.store.readAutomation();f.ports.observe=async()=>{throw Error('thread API must not be called');};f.ports.deliveryGates=()=>({status:'blocked',checks:[{id:'delivery_unique_receipt',status:'blocked',reason:'SENDER_HAS_NO_DURABLE_INTENT_CORRELATION',source:'live'}],source:'live',observedAt:new Date().toISOString(),readOnly:true,realSendingEnabled:false});const result=await f.scheduler.invoke('tasks.inspect',{id:task.id},actor);assert.equal(result.providerChecked,false);assert.equal((result.deliveryGates as {realSendingEnabled:boolean}).realSendingEnabled,false);assert.deepEqual(f.store.readAutomation(),before);assert.equal(f.writes(),0);}finally{await f.close();}});
test('响应丢失持久保留意图/槽位/marker，重启、换键、重建均不能补发；只核对可释放',async()=>{const f=setup();try{
 f.setMode('lost');const input={threadRef:f.ref,prompt:'仅模拟',connectionRevision:1,expectedLatestTurnId:'turn-1',confirm:true};const attempt=await f.delivery.send(null,input,actor,'send');assert.equal(attempt.state,'uncertain');assert.equal(attempt.slot,'held');assert.equal(f.writes(),1);
 const marker=f.store.readAutomation().attempts[0]!.marker;f.delivery.start();assert.equal((await f.delivery.send(null,input,actor,'send')).id,attempt.id);assert.equal(f.writes(),1);
 await assert.rejects(f.delivery.send(null,input,actor,'new-key'),{code:'UNRESOLVED_ATTEMPT'});
 await assert.rejects(f.tasks.invoke('tasks.create',{threadRef:f.ref,prompt:'不能绕过',mode:'observe',maxResumes:3,priority:'normal',expiresAt:null,dailyWindow:{allDay:true},enabled:false},actor,'recreate'),{code:'UNRESOLVED_ATTEMPT'});
 f.store.close();f.store.start();assert.equal(f.store.readAutomation().attempts[0]!.marker,marker);assert.equal((await f.delivery.reconcile(String(attempt.id),actor)).slot,'held');assert.equal(f.writes(),1);
 f.setReceipt(true,false);assert.equal((await f.delivery.reconcile(String(attempt.id),actor)).state,'receipt_matched');assert.equal(f.store.readAutomation().attempts[0]!.slot,'held');f.setReceipt(true,true);assert.equal((await f.delivery.reconcile(String(attempt.id),actor)).slot,'released');assert.equal(f.writes(),1);
 }finally{await f.close();}});
test('托管暂停与撤销发生在写入前时确定取消并回退预占；未决禁止编辑/移除',async()=>{const f=setup();try{
 const task=await f.tasks.invoke('tasks.create',{threadRef:f.ref,prompt:'模拟任务',mode:'auto',maxResumes:3,priority:'normal',expiresAt:null,dailyWindow:{allDay:true},enabled:true,authorization:{allowAutomaticSend:true,connectionRevision:1,expectedLatestTurnId:'turn-1',expectedGoalId:null}},actor,'create');
 const dispatch=f.ports.dispatch;f.ports.dispatch=async(attempt,guard)=>{await f.tasks.invoke('tasks.pause',{id:task.id},actor,'pause-at-boundary');return dispatch(attempt,guard);};
 const result=await f.delivery.send(String(task.id),{taskId:task.id},actor,'send','scheduler.dispatch');assert.equal(result.state,'cancelled_before_write');assert.equal(f.writes(),0);assert.equal(f.store.readAutomation().tasks[0]!.resumeCount,0);
 await f.tasks.invoke('tasks.enable',{id:task.id,confirmedRevision:1,authorization:{allowAutomaticSend:true,connectionRevision:1,expectedLatestTurnId:'turn-1',expectedGoalId:null}},actor,'enable');f.ports.dispatch=dispatch;f.setMode('lost');await f.delivery.send(String(task.id),{taskId:task.id},actor,'send-2','scheduler.dispatch');await f.tasks.invoke('tasks.pause',{id:task.id},actor,'pause');
 await assert.rejects(f.tasks.invoke('tasks.update',{id:task.id,expectedRevision:1,patch:{prompt:'更改'}},actor,'edit'),{code:'UNRESOLVED_ATTEMPT'});await assert.rejects(f.tasks.invoke('tasks.remove',{id:task.id,expectedRevision:1},actor,'remove'),{code:'UNRESOLVED_ATTEMPT'});assert.equal(f.store.readAutomation().tasks[0]!.resumeCount,1);
 }finally{await f.close();}});
test('同目标并发发送至多写一次；同键重放和失效账号不创建第二意图',async()=>{const f=setup();try{
 const input={threadRef:f.ref,prompt:'模拟',connectionRevision:1,expectedLatestTurnId:'turn-1',confirm:true};const results=await Promise.allSettled([f.delivery.send(null,input,actor,'a'),f.delivery.send(null,input,actor,'b')]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.writes(),1);f.revoke();await assert.rejects(f.delivery.send(null,input,actor,'a'),{code:'AUTH_REVOKED'});assert.equal(f.store.readAutomation().attempts.length,1);
 }finally{await f.close();}});
test('队列槽位非抢占、仅观察无意图计数，同一旧额度错误不可重复续跑',async()=>{const f=setup();try{
 await f.scheduler.invoke('queue.configure',{expectedRevision:1,enabled:true,limit:1},actor,'queue');
 const common={prompt:'模拟',mode:'auto',maxResumes:3,priority:'normal',expiresAt:null,dailyWindow:{allDay:true},enabled:true,authorization:{allowAutomaticSend:true,connectionRevision:1,expectedLatestTurnId:'turn-1',expectedGoalId:null}};
 await f.tasks.invoke('tasks.create',{...common,threadRef:f.ref},actor,'task1');await f.tasks.invoke('tasks.create',{...common,threadRef:{...f.ref,threadId:randomUUID()},mode:'observe'},actor,'observe');
 await f.scheduler.tick();assert.equal(f.writes(),1);assert.equal(f.store.readAutomation().tasks[1]!.resumeCount,0);assert.equal(f.store.readAutomation().attempts.length,1);
 f.setReceipt(true,true);await f.scheduler.tick();await f.scheduler.tick();assert.equal(f.writes(),1);
 }finally{await f.close();}});
test('跨午夜本机时段开始含结束不含，时段外及到期不发送',()=>{
 const config=taskConfigSchema.parse({prompt:'模拟',dailyWindow:{allDay:false,start:'22:00',end:'06:00'}});const local=(h:number,m=0)=>new Date(2026,10,17,h,m).getTime();assert.equal(inWindow(config,local(21,59)),false);assert.equal(inWindow(config,local(22)),true);assert.equal(inWindow(config,local(5,59)),true);assert.equal(inWindow(config,local(6)),false);assert.equal(inWindow({...config,expiresAt:new Date(local(23)).toISOString()},local(23)),false);
});

test('最终写入边界重新检查撤销、账号、额度错误和休眠世代，确定未写入才释放计数',async t=>{
 const changes:Record<string,(f:ReturnType<typeof setup>)=>void>={
  revoked:f=>f.revoke(),
  account:f=>{const observe=f.ports.observe;f.ports.observe=async ref=>{const value=await observe(ref);return {...value,binding:{...value.binding,accountBinding:'changed'}};};},
  eligibility:f=>{f.ports.eligibility=async()=>({quotaError:false,latestTurnId:'turn-1',goalActive:false});},
  quota:f=>{f.ports.quota=async()=>({available:null,stale:true});},
  suspend:f=>{f.delivery.stopNew();f.delivery.resume();}
 };
 for(const [name,change] of Object.entries(changes))await t.test(name,async()=>{const f=setup();try{
  const task=await f.tasks.invoke('tasks.create',{threadRef:f.ref,prompt:'隔离边界验证',mode:'auto',enabled:true,authorization:{allowAutomaticSend:true,connectionRevision:1,expectedLatestTurnId:'turn-1',expectedGoalId:null}},actor,'create');
  const dispatch=f.ports.dispatch;f.ports.dispatch=async(attempt,guard)=>{assert.equal(f.store.readAutomation().attempts[0]!.state,'dispatching');change(f);return dispatch(attempt,guard);};
  const result=await f.delivery.send(String(task.id),{taskId:task.id},actor,'send','scheduler.dispatch');assert.equal(result.state,'cancelled_before_write');assert.equal(result.slot,'released');assert.equal(f.writes(),0);assert.equal(f.store.readAutomation().tasks[0]!.resumeCount,0);
 }finally{await f.close();}});
});

test('优先级与同级移动不抢占在途，降低并发上限保留全部 held，空槽按新顺序派发',async()=>{const f=setup();try{
 await f.scheduler.invoke('queue.configure',{expectedRevision:1,enabled:true,limit:2},actor,'limit-two');
 const create=async(key:string,priority:string)=>f.tasks.invoke('tasks.create',{threadRef:{...f.ref,threadId:randomUUID()},prompt:'隔离队列',mode:'auto',priority,enabled:true,authorization:{allowAutomaticSend:true,connectionRevision:1,expectedLatestTurnId:'turn-1',expectedGoalId:null}},actor,key);
 const low=await create('low','low'),first=await create('first','high'),second=await create('second','high');
 await f.scheduler.invoke('tasks.reorder',{id:second.id,direction:'up',expectedQueueRevision:2},actor,'move');
 await assert.rejects(f.scheduler.invoke('tasks.reorder',{id:first.id,direction:'up',expectedQueueRevision:2},actor,'stale-move'),{code:'REVISION_CONFLICT'});
 await f.scheduler.tick();assert.deepEqual(f.store.readAutomation().attempts.map(x=>x.taskId),[second.id,first.id]);assert.equal(f.writes(),2);
 const next=await create('next','high');await f.scheduler.invoke('queue.configure',{expectedRevision:3,enabled:true,limit:1},actor,'limit-one');await f.scheduler.tick();assert.equal(f.writes(),2);assert.equal(f.store.readAutomation().attempts.filter(x=>x.slot==='held').length,2);
 const finished=new Set<string>();f.ports.receipt=async attempt=>({matched:finished.has(attempt.id),turnId:finished.has(attempt.id)?'sent-turn':null,turnFinished:finished.has(attempt.id),goalComplete:false});
 finished.add(f.store.readAutomation().attempts[0]!.id);await f.scheduler.tick();assert.equal(f.writes(),2);
 finished.add(f.store.readAutomation().attempts[1]!.id);await f.scheduler.tick();assert.equal(f.writes(),3);assert.equal(f.store.readAutomation().attempts[2]!.taskId,next.id);assert.equal(f.store.readAutomation().tasks.find(x=>x.id===low.id)!.resumeCount,0);
 }finally{await f.close();}});

test('任务诊断仅读取额度快照和目标，不刷新额度、不改授权、事件、计数或调度状态',async()=>{const f=setup();try{
 const task=await f.tasks.invoke('tasks.create',{threadRef:f.ref,prompt:'隔离观察',mode:'observe'},actor,'create');
 f.ports.quota=async()=>{throw new Error('不允许诊断刷新额度');};f.ports.peekQuota=()=>({available:true,stale:false});
 const before=f.store.readAutomation();const result=await f.scheduler.invoke('tasks.inspect',{id:task.id},actor);assert.equal(result.status,'blocked');assert.deepEqual(result.reasons,['paused']);assert.equal(result.providerChecked,true);assert.deepEqual(f.store.readAutomation(),before);assert.equal(f.writes(),0);
 }finally{await f.close();}});
