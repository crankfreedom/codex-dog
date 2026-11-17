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
