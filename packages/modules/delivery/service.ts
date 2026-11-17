import {AutomationError,attemptView,unresolved} from '../automation/ports.ts';
import type {AutomationStorePort,DeliveryPorts,Task,Attempt,Binding,LeaseRecord} from '../automation/ports.ts';
import type {ActorRef} from '../persistence/stage3-ports.ts';
import {previous,commit,findTask} from '../automation/mutations.ts';
import {page} from '../automation/paging.ts';
import {inWindow} from '../automation/policy.ts';
function sameBinding(a:Binding,b:Binding){return a.accountBinding===b.accountBinding&&a.connectionRevision===b.connectionRevision&&a.goalId===b.goalId;}
export class DeliveryService {
 private store:AutomationStorePort;private ports:DeliveryPorts;private stopped=false;private epoch=0;private intentEpoch=new Map<string,number>();private leases=new Map<string,LeaseRecord>();private active=new Set<Promise<unknown>>();
 constructor(store:AutomationStorePort,ports:DeliveryPorts){this.store=store;this.ports=ports;}
 start(){this.stopped=false;const state=this.store.readAutomation();let changed=false;for(const attempt of state.attempts)if(attempt.slot==='held'&&['prepared','dispatching'].includes(attempt.state)){attempt.state='uncertain';attempt.reason='process_interrupted';changed=true;const task=state.tasks.find(x=>x.id===attempt.taskId);if(task)task.phase='send_uncertain';}if(changed)this.store.commitAutomation(state.version,state);}
 async close(){this.stopped=true;await Promise.allSettled([...this.active]);for(const [id] of this.leases)if(this.find(id).slot==='released')try{this.release(id);}catch{}this.leases.clear();}
 stopNew(){this.stopped=true;this.epoch++;}
 resume(){this.stopped=false;}
 async drain(){await Promise.allSettled([...this.active]);}
 private checkLocal(attempt:Attempt){
  if(this.stopped)throw new AutomationError('APP_STOPPING','当前不接受新投递');
  if(this.intentEpoch.get(attempt.id)!==this.epoch)throw new AutomationError('AUTH_REVOKED','派发跨过休眠或生命周期边界，取消旧资格');
  const state=this.store.readAutomation(),current=state.attempts.find(x=>x.id===attempt.id);if(!current||current.state!=='dispatching')throw new AutomationError('UNRESOLVED_ATTEMPT','意图状态已变化');
  if(attempt.taskId){const task=findTask(state,attempt.taskId);if(!task.enabled||task.revision!==attempt.taskRevision||!task.authorization||!sameBinding(task.authorization,attempt.binding)||!inWindow(task.config,this.ports.now()))throw new AutomationError('AUTH_REVOKED','任务暂停、修订、到期或授权已变化');}
  const lease=this.leases.get(attempt.id);if(!lease)throw new AutomationError('TARGET_LOCK_UNVERIFIED','投递缺少目标锁');this.ports.lease.assertOwned(lease);
 }
 private async finalGuard(attempt:Attempt){
  this.checkLocal(attempt);await this.ports.authorize(attempt.owner,'messages.send');
  const observation=await this.ports.observe(attempt.threadRef);
  if(!observation.known||!observation.goalKnown||observation.approval||!sameBinding(attempt.binding,observation.binding)||observation.binding.latestTurnId!==attempt.binding.latestTurnId)throw new AutomationError('CONNECTION_IDENTITY_CHANGED','派发前账号、Goal 或轮次发生变化');
  if(!observation.idle)throw new AutomationError('TARGET_BUSY','派发前目标已不空闲');
  if(attempt.taskId){const eligibility=await this.ports.eligibility(attempt.threadRef);if(!eligibility.quotaError||eligibility.latestTurnId!==attempt.binding.latestTurnId)throw new AutomationError('TASK_BLOCKED','派发前最新轮次不再是明确额度错误');}
  const quota=await this.ports.quota();if(quota.available!==true||quota.stale)throw new AutomationError('QUOTA_UNAVAILABLE','派发前额度未知、过期或耗尽');
  await this.ports.authorize(attempt.owner,'messages.send');this.checkLocal(attempt);
 }
 async send(taskId:string|null,p:Record<string,unknown>,actor:ActorRef,key:string,operation='threads.send'):Promise<Record<string,unknown>>{
  await this.ports.authorize(actor,'messages.send');const old=previous(this.store,actor.clientId,operation,key,p,this.ports);if(old.result){const id=String(old.result.id);return attemptView(this.find(id));}
  if(this.stopped)throw new AutomationError('APP_STOPPING','当前不接受新投递');
  const before=this.store.readAutomation(),task=taskId?findTask(before,taskId):undefined,ref=task?.threadRef??p.threadRef as Task['threadRef'];
  if(task){if(!task.enabled||task.config.mode!=='auto'||!task.authorization||task.resumeCount>=task.config.maxResumes||!inWindow(task.config,this.ports.now()))throw new AutomationError('TASK_BLOCKED','任务未授权、到期、时段外或达到上限');}
  else if(before.tasks.some(x=>!x.archived&&x.threadRef.threadId===ref.threadId))throw new AutomationError('TARGET_MANAGED','单次发送不能绕过托管');
  if(unresolved(before,ref.threadId))throw new AutomationError('UNRESOLVED_ATTEMPT','目标已有未决意图');
  const observation=await this.ports.observe(ref),quota=await this.ports.quota();
  if(observation.source==='live')throw new AutomationError('TARGET_BINDING_UNVERIFIED','真实账号/目标及旧锁门禁未通过');
  if(!observation.known||!observation.goalKnown||!observation.idle||observation.approval||quota.available!==true||quota.stale)throw new AutomationError('TARGET_STATE_UNKNOWN','目标或额度不能确认');
  if(task){const eligible=await this.ports.eligibility(ref);if(!sameBinding(task.authorization!,observation.binding)||!eligible.quotaError||eligible.latestTurnId!==observation.binding.latestTurnId||before.attempts.some(x=>x.taskId===task.id&&x.binding.latestTurnId===eligible.latestTurnId&&x.state!=='cancelled_before_write'))throw new AutomationError('TASK_BLOCKED','仅未处理过的最新轮次明确额度错误可触发自动续跑');}
  else if(!observation.idle||observation.binding.goalId!==null||observation.binding.connectionRevision!==p.connectionRevision||observation.binding.latestTurnId!==p.expectedLatestTurnId||p.confirm!==true)throw new AutomationError('TARGET_BUSY','单次发送要求明确授权、空闲、无 Goal 且轮次一致');
  await this.ports.authorize(actor,'messages.send');const lease=this.ports.lease.acquire(ref.threadId);
  let attempt:Attempt|undefined;
  try{
   const state=this.store.readAutomation();const replay=previous(this.store,actor.clientId,operation,key,p,this.ports);if(replay.result){this.ports.lease.release(lease);return attemptView(this.find(String(replay.result.id)));}
   if(state.version!==before.version)throw new AutomationError('REVISION_CONFLICT','核验期间业务状态变化');
   const held=state.attempts.filter(x=>x.slot==='held').length;if(state.queue.enabled&&held>=state.queue.limit)throw new AutomationError('QUEUE_FULL','并发槽位已满');
   const at=new Date(this.ports.now()).toISOString();attempt={id:this.ports.newId(),source:observation.source,taskId,threadRef:ref,marker:this.ports.newId(),prompt:task?.config.prompt??String(p.prompt),taskRevision:task?.revision??null,binding:observation.binding,owner:actor,lease,state:'prepared',slot:'held',submitted:false,receiptMatched:false,turnId:null,reason:'intent_committed',createdAt:at};
   if(state.attempts.length>=10000)throw new AutomationError('CLIENT_LIMIT','投递记录达到上限');
   state.attempts.push(attempt);if(task){const current=findTask(state,task.id);current.resumeCount++;current.phase='sending';}
   this.ports.lease.assertOwned(lease);commit(this.store,state,old,attemptView(attempt),{resourceId:taskId??attempt.id,at,type:'delivery.prepared',reason:'intent_committed',revision:task?.revision??null});this.leases.set(attempt.id,lease);this.intentEpoch.set(attempt.id,this.epoch);
  }catch(error){try{this.ports.lease.release(lease);}catch{}throw error;}
  const work=this.dispatch(attempt!);this.active.add(work);try{return await work;}finally{this.active.delete(work);}
 }
 private async dispatch(attempt:Attempt){
  this.transition(attempt.id,'dispatching','dispatch_boundary');
  let result:{outcome:'submitted'|'not_written'|'uncertain';turnId:string|null};
  try{result=await this.ports.dispatch(this.find(attempt.id),()=>this.finalGuard(this.find(attempt.id)));}
  catch{result={outcome:'uncertain',turnId:null};}
  const state=this.store.readAutomation(),current=state.attempts.find(x=>x.id===attempt.id)!;current.turnId=result.turnId;current.submitted=result.outcome==='submitted';current.state=result.outcome==='submitted'?'submitted':result.outcome==='not_written'?'cancelled_before_write':'uncertain';current.reason=result.outcome;
  const task=state.tasks.find(x=>x.id===attempt.taskId);
  if(result.outcome==='not_written'){current.slot='released';if(task){task.resumeCount--;task.phase=task.enabled?'observing':'suspended';}}
  else if(task)task.phase=result.outcome==='uncertain'?'send_uncertain':'verifying';
  this.store.commitAutomation(state.version,state,{resourceId:attempt.taskId??attempt.id,at:new Date(this.ports.now()).toISOString(),type:'delivery.'+current.state,reason:current.reason,revision:attempt.taskRevision});
  if(current.slot==='released')this.release(current.id);return attemptView(current);
 }
 private transition(id:string,next:Attempt['state'],reason:string){const state=this.store.readAutomation(),current=state.attempts.find(x=>x.id===id)!;current.state=next;current.reason=reason;this.store.commitAutomation(state.version,state);}
 private release(id:string){const lease=this.leases.get(id);if(lease){this.ports.lease.release(lease);this.leases.delete(id);}else{const record=this.find(id).lease;if(record)this.ports.lease.releaseRecorded?.(record);}}
 private find(id:string){const attempt=this.store.readAutomation().attempts.find(x=>x.id===id);if(!attempt)throw new AutomationError('RESOURCE_NOT_FOUND','投递不存在');return attempt;}
 async reconcile(id:string,actor:ActorRef,scope:'messages.send'|'tasks.manage'='messages.send'){
  await this.ports.authorize(actor,scope);const before=this.find(id);if(before.source==='unknown')throw new AutomationError('SOURCE_PROOF_UNAVAILABLE','历史意图来源无法证明，保持未决');if(before.slot==='released')return attemptView(before);
  const receipt=await this.ports.receipt(before);await this.ports.authorize(actor,scope);
  const state=this.store.readAutomation(),current=state.attempts.find(x=>x.id===id)!;if(current.slot==='released')return attemptView(current);
  if(receipt.matched&&receipt.turnId&&(!current.turnId||current.turnId===receipt.turnId)){
   current.receiptMatched=true;current.turnId=receipt.turnId;current.state=receipt.turnFinished?'turn_finished':'receipt_matched';if(receipt.turnFinished)current.slot='released';
   const task=state.tasks.find(x=>x.id===current.taskId);if(task){task.phase=receipt.turnFinished?(receipt.goalComplete?'completed':task.enabled?'observing':'suspended'):'verifying';if(receipt.goalComplete&&receipt.turnFinished){task.archived=true;task.enabled=false;task.reason='goal_completed';}}
   this.store.commitAutomation(state.version,state,{resourceId:current.taskId??current.id,at:new Date(this.ports.now()).toISOString(),type:receipt.goalComplete&&receipt.turnFinished?'task.completed':'delivery.'+current.state,reason:receipt.goalComplete&&receipt.turnFinished?'goal_completed':'unique_receipt',revision:current.taskRevision});if(current.slot==='released')this.release(id);
  }
  return attemptView(current);
 }
 async invoke(operation:string,p:Record<string,unknown>,actor:ActorRef,key?:string):Promise<Record<string,unknown>>{
  if(operation==='threads.send'){if(!key)throw new AutomationError('INVALID_ARGUMENT','发送必须携带幂等键');return this.send(null,p,actor,key);}
  if(operation==='attempts.get')return attemptView(this.find(String(p.id)));
  if(operation==='attempts.list')return page(this.store,this.ports,operation,{taskId:p.taskId??null},this.store.readAutomation().attempts.map((x,index)=>({sequence:index+1,value:x})).filter(x=>!p.taskId||x.value.taskId===p.taskId).map(x=>({...x,value:attemptView(x.value)})),p);
  if(!key)throw new AutomationError('INVALID_ARGUMENT','核对必须携带幂等键');
  if(operation==='tasks.reconcile'){await this.ports.authorize(actor,'tasks.manage');const task=findTask(this.store.readAutomation(),String(p.id));const attempts=this.store.readAutomation().attempts.filter(x=>x.taskId===task.id&&x.slot==='held');return {items:await Promise.all(attempts.map(x=>this.reconcile(x.id,actor,'tasks.manage')))};}
  return this.reconcile(String(p.id),actor);
 }
}
