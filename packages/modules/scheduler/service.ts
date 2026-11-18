import {AutomationError,taskView} from '../automation/ports.ts';
import type {AutomationStorePort,AutomationPorts,Task} from '../automation/ports.ts';
import type {ActorRef} from '../persistence/stage3-ports.ts';
import {previous,commit,findTask} from '../automation/mutations.ts';
import {inWindow} from '../automation/policy.ts';
interface DispatchPort {send(taskId:string,p:Record<string,unknown>,actor:ActorRef,key:string,operation:string):Promise<Record<string,unknown>>;reconcile(id:string,actor:ActorRef):Promise<Record<string,unknown>>}
export class SchedulerService {
 private store:AutomationStorePort;private ports:AutomationPorts;private delivery:DispatchPort;private cancel?:()=>void;private stopped=true;private running?:Promise<Record<string,unknown>>;private schedule:(delay:number,run:()=>void)=>()=>void;
 constructor(store:AutomationStorePort,ports:AutomationPorts,delivery:DispatchPort,schedule:SchedulerService['schedule']){this.store=store;this.ports=ports;this.delivery=delivery;this.schedule=schedule;}
 start(){const state=this.store.readAutomation();let changed=false;for(const item of state.backgroundOperations)if(['accepted','running'].includes(item.state)){item.state='failed';item.error='PROCESS_INTERRUPTED';item.updatedAt=new Date(this.ports.now()).toISOString();changed=true;}if(changed)this.store.commitAutomation(state.version,state);this.stopped=false;this.configure();}
 suspend(){this.stopped=true;this.cancel?.();this.cancel=undefined;}
 resume(){this.stopped=false;this.configure();}
 configure(){this.cancel?.();this.cancel=undefined;if(this.stopped)return;const config=this.store.readAutomation().scheduler;if(config.enabled)this.cancel=this.schedule(config.pollSeconds*1000,()=>{void this.tick().finally(()=>this.configure());});}
 async close(){this.stopped=true;this.cancel?.();this.cancel=undefined;await this.running?.catch(()=>{});}
 private sorted(){const weight={high:0,normal:1,low:2};return this.store.readAutomation().tasks.filter(x=>!x.archived).sort((a,b)=>weight[a.config.priority]-weight[b.config.priority]||a.order-b.order||a.id.localeCompare(b.id));}
 private phase(task:Task,phase:string,reason:string){const state=this.store.readAutomation(),current=findTask(state,task.id);if(current.phase===phase&&current.reason===reason)return;current.phase=phase;current.reason=reason;if(reason==='expired')current.enabled=false;this.store.commitAutomation(state.version,state,{resourceId:task.id,at:new Date(this.ports.now()).toISOString(),type:'task.observed',reason,revision:task.revision});}
 tick():Promise<Record<string,unknown>>{if(this.running)return this.running;const run=this.execute();this.running=run;void run.finally(()=>{if(this.running===run)this.running=undefined;}).catch(()=>{});return run;}
 private async execute(){const outcomes:Array<Record<string,unknown>>=[];if(this.stopped)return {items:outcomes,stopped:true};
  for(const task of this.sorted()){
   if(this.stopped)break;
   const pending=this.store.readAutomation().attempts.filter(x=>x.taskId===task.id&&x.slot==='held');
   if(pending.length){for(const attempt of pending)try{await this.delivery.reconcile(attempt.id,task.owner);}catch{}continue;}
   if(!task.enabled)continue;
   if(task.config.expiresAt&&Date.parse(task.config.expiresAt)<=this.ports.now()){this.phase(task,'suspended','expired');continue;}
   if(!inWindow(task.config,this.ports.now())){this.phase(task,'suspended','outside_daily_window');continue;}
   try{await this.ports.authorize(task.owner,'tasks.manage');const observation=await this.ports.observe(task.threadRef);
    if(!observation.known||!observation.goalKnown||observation.approval){this.phase(task,'suspended','target_state_unknown');continue;}
    if(task.authorization&&(task.authorization.connectionRevision!==observation.binding.connectionRevision||task.authorization.accountBinding!==observation.binding.accountBinding||task.authorization.goalId!==observation.binding.goalId)){this.phase(task,'suspended','authorization_binding_changed');continue;}
    if(observation.completionConfirmed){const state=this.store.readAutomation(),current=findTask(state,task.id);if(!state.attempts.some(x=>x.threadRef.threadId===task.threadRef.threadId&&x.slot==='held')){current.archived=true;current.enabled=false;current.phase='completed';current.reason='goal_completed';current.authorization=null;this.store.commitAutomation(state.version,state,{resourceId:task.id,at:new Date(this.ports.now()).toISOString(),type:'task.completed',reason:'goal_completed',revision:task.revision});}continue;}
    if(task.config.mode==='observe'){const quota=await this.ports.quota?.();this.phase(task,quota?.available===false?'waiting_quota':quota?.available===true&&!quota.stale?'observing':'suspended',quota?.available===true&&!quota.stale&&task.phase==='waiting_quota'?'observation_quota_recovered':quota?.available===false?'observation_quota_blocked':quota?.available===true&&!quota.stale?'observation_only':'quota_unknown');outcomes.push({id:task.id,observationOnly:true});continue;}
    const attempt=await this.delivery.send(task.id,{taskId:task.id,revision:task.revision},task.owner,'task-'+task.id+'-'+task.revision+'-'+task.resumeCount,'scheduler.dispatch');outcomes.push(attempt);
   }catch(error){const code=error&&typeof error==='object'&&'code'in error?String(error.code):'PROVIDER_UNAVAILABLE';this.phase(task,code==='QUEUE_FULL'?'observing':'suspended',code);outcomes.push({id:task.id,blocked:code});}
  }return {items:outcomes};
 }
 async invoke(operation:string,p:Record<string,unknown>,actor:ActorRef,key?:string):Promise<Record<string,unknown>>{
  const state=this.store.readAutomation();
  if(operation==='queue.get')return {...state.queue,held:state.attempts.filter(x=>x.slot==='held').length,items:this.sorted().map(x=>taskView(x))};
  if(operation==='scheduler.settings.get')return {...state.scheduler,running:!!this.running};
  if(operation==='tasks.inspect'){const task=findTask(state,String(p.id));const reasons:string[]=[];let unknown=false,providerChecked=false;if(!task.enabled)reasons.push('paused');if(!inWindow(task.config,this.ports.now()))reasons.push('outside_window_or_expired');if(task.resumeCount>=task.config.maxResumes)reasons.push('resume_limit');if(state.attempts.some(x=>x.taskId===task.id&&x.slot==='held'))reasons.push('unresolved_attempt');if(task.config.mode==='auto'&&!task.authorization)reasons.push('business_authorization_required');
   const deliveryGates=this.ports.deliveryGates?.(task.threadRef);
   if(deliveryGates){unknown=true;reasons.push(...deliveryGates.checks.filter(x=>x.status!=='passed').map(x=>x.reason));}
   else try{const observation=await this.ports.observe(task.threadRef);providerChecked=true;if(!observation.known||!observation.goalKnown){unknown=true;reasons.push('target_or_goal_unknown');}if(observation.approval)reasons.push('approval_required');if(!observation.idle)reasons.push('target_busy');if(observation.source==='live'){unknown=true;reasons.push('cross_source_binding_unverified');}if(task.authorization&&(task.authorization.connectionRevision!==observation.binding.connectionRevision||task.authorization.accountBinding!==observation.binding.accountBinding||task.authorization.goalId!==observation.binding.goalId))reasons.push('authorization_binding_changed');}catch{unknown=true;reasons.push('provider_unavailable');}
   try{const quota=this.ports.peekQuota?.();if(!quota||quota.stale||quota.available===null){unknown=true;reasons.push('quota_unknown_or_expired');}else if(!quota.available)reasons.push('quota_blocked');}catch{unknown=true;reasons.push('quota_unavailable');}
   try{await this.ports.authorize(task.owner,'tasks.manage');if(task.config.mode==='auto')await this.ports.authorize(task.owner,'messages.send');}catch{reasons.push('original_authorization_invalid');}
   return {id:task.id,status:reasons.length?(unknown?'unknown':'blocked'):'passed',reasons,providerChecked,...(deliveryGates?{deliveryGates}:{})};}
  const scope=operation==='queue.configure'||operation==='scheduler.settings.update'?'settings.manage':'tasks.manage';await this.ports.authorize(actor,scope);
  if(operation==='scheduler.runNow')await this.ports.authorize(actor,'messages.send');
  const prior=previous(this.store,actor.clientId,operation,key,p,this.ports);if(prior.result)return prior.result;
  const current=this.store.readAutomation(),at=new Date(this.ports.now()).toISOString();let result:Record<string,unknown>;
  if(operation==='scheduler.runNow'){
   result={id:this.ports.newId(),accepted:true,kind:operation};if(current.backgroundOperations.length>=1000)throw new AutomationError('CLIENT_LIMIT','调度操作记录达到上限');current.backgroundOperations.push({id:String(result.id),owner:actor.clientId,kind:'scheduler.runNow',state:'running',createdAt:at,updatedAt:at,error:null,resultCount:null});commit(this.store,current,prior,result,{resourceId:String(result.id),at,type:operation,reason:'explicit',revision:null});
   try{const tick=await this.tick();const saved=this.store.readAutomation(),item=saved.backgroundOperations.find(x=>x.id===result.id)!;item.state='succeeded';item.resultCount=(tick.items as unknown[]).length;item.updatedAt=new Date(this.ports.now()).toISOString();this.store.commitAutomation(saved.version,saved);}catch(error){const saved=this.store.readAutomation(),item=saved.backgroundOperations.find(x=>x.id===result.id)!;item.state='failed';item.error='SCHEDULER_FAILED';item.updatedAt=new Date(this.ports.now()).toISOString();this.store.commitAutomation(saved.version,saved);throw error;}return result;
  }
  if(operation==='queue.configure'){if(current.queue.revision!==p.expectedRevision)throw new AutomationError('REVISION_CONFLICT','队列修订已变化');current.queue={revision:current.queue.revision+1,enabled:p.enabled===true,limit:Number(p.limit)};result={...current.queue};}
  else if(operation==='scheduler.settings.update'){if(current.scheduler.revision!==p.expectedRevision)throw new AutomationError('REVISION_CONFLICT','调度修订已变化');current.scheduler={revision:current.scheduler.revision+1,enabled:p.enabled===true,pollSeconds:Number(p.pollSeconds)};result={...current.scheduler};}
  else if(operation==='tasks.reorder'){
   if(current.queue.revision!==p.expectedQueueRevision)throw new AutomationError('REVISION_CONFLICT','队列修订已变化');const task=findTask(current,String(p.id));const peers=current.tasks.filter(x=>!x.archived&&x.config.priority===task.config.priority).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));peers.forEach((x,i)=>{x.order=i;});const index=peers.indexOf(task),other=peers[index+(p.direction==='up'?-1:1)];if(other)[task.order,other.order]=[other.order,task.order];current.queue.revision++;result={id:task.id,order:task.order,queueRevision:current.queue.revision};
  }else throw new AutomationError('CAPABILITY_UNSUPPORTED','调度操作不存在');
  const saved=commit(this.store,current,prior,result,{resourceId:String(p.id??operation),at,type:operation,reason:'explicit',revision:Number(result.revision??current.queue.revision)});if(operation==='scheduler.settings.update')this.configure();return saved;
 }
}
