import {AutomationError} from '../automation/ports.ts';
import type {AutomationStorePort,AutomationPorts} from '../automation/ports.ts';
import type {ActorRef} from '../persistence/stage3-ports.ts';
import type {Appointment,CardObservation,CardProviderPort} from './ports.ts';
import {appointmentView} from './ports.ts';
import {previous,commit} from '../automation/mutations.ts';
import {page} from '../automation/paging.ts';
export class CardService {
 private store:AutomationStorePort;private ports:AutomationPorts;private provider:CardProviderPort;private snapshot?:CardObservation;private error:string|null=null;private stopped=true;private suspended=false;private epoch=0;private timer?:()=>void;private schedule:(delay:number,run:()=>void)=>()=>void;private running?:Promise<void>;private allowLive:()=>boolean;
 constructor(store:AutomationStorePort,ports:AutomationPorts,provider:CardProviderPort,schedule:CardService['schedule'],allowLive=()=>false){this.store=store;this.ports=ports;this.provider=provider;this.schedule=schedule;this.allowLive=allowLive;}
 start(){this.stopped=false;const state=this.store.readAutomation();let changed=false;for(const item of state.appointments){if(item.state==='running'){item.state='uncertain';item.reason='restart_during_consume';changed=true;}else if(item.state==='pending'&&Date.parse(item.scheduledAt)<=this.ports.now()){item.state='missed';item.reason='application_was_offline';changed=true;}}if(changed)this.store.commitAutomation(state.version,state);this.arm();}
 private arm(){this.timer?.();this.timer=undefined;if(this.stopped||this.suspended)return;const pending=this.store.readAutomation().appointments.filter(x=>x.state==='pending');if(!pending.length)return;const delay=Math.max(0,Math.min(...pending.map(x=>Date.parse(x.scheduledAt)))-this.ports.now());this.timer=this.schedule(Math.min(Math.max(delay,100),2147483647),()=>{void this.tick().finally(()=>this.arm());});}
 suspend(){this.suspended=true;this.epoch++;this.timer?.();this.timer=undefined;}
 async drain(){await this.running?.catch(()=>{});}
 resume(){const state=this.store.readAutomation();let changed=false;for(const item of state.appointments)if(item.state==='pending'&&Date.parse(item.scheduledAt)<=this.ports.now()){item.state='missed';item.reason='sleep_crossed_appointment';item.revision++;changed=true;}if(changed)this.store.commitAutomation(state.version,state);this.suspended=false;this.arm();}
 async close(){this.stopped=true;this.epoch++;this.timer?.();this.timer=undefined;await this.provider.close();await this.running?.catch(()=>{});}
 private view(){const snapshot=this.snapshot,stale=!snapshot||this.ports.now()-Date.parse(snapshot.observedAt)>30000;return {source:snapshot?.source??'unknown',observedAt:snapshot?.observedAt??null,stale,availability:!snapshot||stale||this.error?'unknown':'known',error:this.error,items:!snapshot?null:snapshot.cards.map(x=>({cardKey:this.ports.digest(x.id),title:x.title,status:x.status,expiresAt:x.expiresAt,idSuffix:x.id.slice(-4)}))};}
 async refresh(){try{const snapshot=await this.provider.read();if(!snapshot.verified||!snapshot.accountBinding||snapshot.cards.length>200)throw new AutomationError('PROVIDER_IDENTITY_UNAVAILABLE','无法确认卡片来源身份');this.snapshot=snapshot;this.error=null;return this.view();}catch(error){this.snapshot=undefined;this.error=error&&typeof error==='object'&&'code'in error?String(error.code):'PROVIDER_UNAVAILABLE';throw new AutomationError(this.error,'卡片读取失败，当前卡片未知');}}
 private event(item:Appointment,type:string){return {resourceId:item.id,at:new Date(this.ports.now()).toISOString(),type,reason:item.reason,revision:item.revision};}
 private async guard(item:Appointment,reconcile=false,epoch=this.epoch){
  if(this.stopped||this.suspended||epoch!==this.epoch)throw new AutomationError('APP_STOPPING','应用停止或跨过休眠');await this.ports.authorize(item.owner,'cards.consume');await this.ports.authorize(item.owner,'cards.manage');
  const observation=await this.provider.read();const selected=observation.cards.find(x=>x.id===item.creditId);
  if(observation.source==='live'&&!this.allowLive())throw new AutomationError('LIVE_EFFECTS_NOT_AUTHORIZED','当前卡来源仅允许真实只读');
  if(item.source!==observation.source||!observation.verified||observation.accountBinding!==item.accountBinding||!selected||(!reconcile&&selected.status!=='available')||selected.expiresAt&&Date.parse(selected.expiresAt)<=this.ports.now())throw new AutomationError('CONNECTION_IDENTITY_CHANGED','账号或指定卡片已变化');
  if(!reconcile&&this.ports.now()-Date.parse(item.scheduledAt)>10000)throw new AutomationError('APPOINTMENT_MISSED','预约已错过，禁止补用');
  await this.ports.authorize(item.owner,'cards.consume');if(this.stopped||this.suspended||epoch!==this.epoch)throw new AutomationError('APP_STOPPING','应用停止或跨过休眠');const state=this.store.readAutomation(),current=state.appointments.find(x=>x.id===item.id)!;if(current.state!=='running')throw new AutomationError('REVISION_CONFLICT','预约领取状态已变化');if(state.appointments.some(x=>x.id!==item.id&&x.accountBinding===item.accountBinding&&['running','uncertain'].includes(x.state)))throw new AutomationError('UNRESOLVED_CONSUMPTION','同账号另一笔消费未决，不换卡执行');
 }
 private find(id:string){const item=this.store.readAutomation().appointments.find(x=>x.id===id);if(!item)throw new AutomationError('RESOURCE_NOT_FOUND','预约不存在');return item;}
 tick():Promise<void>{if(this.running)return this.running;const run=this.executeDue();this.running=run;void run.finally(()=>{if(this.running===run)this.running=undefined;}).catch(()=>{});return run;}
 private async executeDue(){if(this.stopped||this.suspended)return;for(const item of this.store.readAutomation().appointments.filter(x=>x.state==='pending'&&Date.parse(x.scheduledAt)<=this.ports.now())){if(this.stopped||this.suspended)break;if(this.ports.now()-Date.parse(item.scheduledAt)>10000){const state=this.store.readAutomation(),current=state.appointments.find(x=>x.id===item.id)!;if(current.state!=='pending')continue;current.state='missed';current.reason='sleep_or_late_wake';current.revision++;this.store.commitAutomation(state.version,state,this.event(current,'reset.missed'));continue;}if(this.store.readAutomation().appointments.some(x=>x.id!==item.id&&x.accountBinding===item.accountBinding&&['running','uncertain'].includes(x.state)))continue;await this.execute(item.id,false);}}
 private async execute(id:string,reconcile:boolean):Promise<Record<string,unknown>>{
  const state=this.store.readAutomation(),item=state.appointments.find(x=>x.id===id)!;
  if(this.stopped||this.suspended)throw new AutomationError('APP_STOPPING','应用停止或休眠中');if(item.source==='unknown')throw new AutomationError('SOURCE_PROOF_UNAVAILABLE','历史预约来源无法证明，保持原状态');
  if(state.appointments.some(x=>x.id!==id&&x.accountBinding===item.accountBinding&&['running','uncertain'].includes(x.state)))throw new AutomationError('UNRESOLVED_CONSUMPTION','同账号另一笔消费未决');
  if(item.state!==(reconcile?'uncertain':'pending'))throw new AutomationError('REVISION_CONFLICT','预约不能领取或正在处理中');
  item.state='running';item.reason=reconcile?'reconciling_original_key':'claimed';item.revision++;item.calls++;this.store.commitAutomation(state.version,state,this.event(item,'reset.claimed'));
  let result:Awaited<ReturnType<CardProviderPort['consume']>>;const epoch=this.epoch;
  try{result=await (reconcile?this.provider.reconcile(item,()=>this.guard(item,true,epoch)):this.provider.consume(item,()=>this.guard(item,false,epoch)));}catch{result={outcome:'uncertain'};}
  const current=this.store.readAutomation(),saved=current.appointments.find(x=>x.id===id)!;
  saved.state=result.outcome==='uncertain'||reconcile&&result.outcome==='not_written'?'uncertain':result.outcome==='not_written'?'failed':'succeeded';saved.outcome=result.outcome;saved.reason=result.outcome;saved.updatedAt=new Date(this.ports.now()).toISOString();saved.revision++;
  this.store.commitAutomation(current.version,current,this.event(saved,'reset.'+saved.state));return appointmentView(saved);
 }
 async invoke(operation:string,p:Record<string,unknown>,actor:ActorRef,key?:string):Promise<Record<string,unknown>>{
  if(operation==='resetCards.list')return this.view();if(operation==='resetCards.refresh')return this.refresh();
  if(operation==='resetAppointments.list')return page(this.store,this.ports,operation,{},this.store.readAutomation().appointments.map((x,index)=>({sequence:index+1,value:appointmentView(x)})),p);
  await this.ports.authorize(actor,'cards.manage');if(operation!=='resetAppointments.cancel')await this.ports.authorize(actor,'cards.consume');
  const prior=previous(this.store,actor.clientId,operation,key,p,this.ports);if(prior.result)return operation==='resetAppointments.reconcile'?appointmentView(this.find(String(p.id))):prior.result;
  if(this.stopped)throw new AutomationError('APP_STOPPING','应用正在停止');
  if(operation==='resetAppointments.reconcile'){
   const current=this.store.readAutomation(),item=this.find(String(p.id));if(item.state!=='uncertain')throw new AutomationError('REVISION_CONFLICT','仅未决消费可用原键核对');
   commit(this.store,current,prior,appointmentView(item),this.event(item,'reset.reconcile_requested'));return this.execute(item.id,true);
  }
  if(operation==='resetAppointments.cancel'){
   const state=this.store.readAutomation(),item=state.appointments.find(x=>x.id===p.id);if(!item||item.revision!==p.expectedRevision)throw new AutomationError('REVISION_CONFLICT','预约修订变化');if(item.state!=='pending')throw new AutomationError('OPERATION_IRREVERSIBLE','已领取或未决的消费不能取消');item.state='cancelled';item.reason='explicit';item.revision++;const result=commit(this.store,state,prior,appointmentView(item),this.event(item,operation));this.arm();return result;
  }
  const scheduled=Date.parse(String(p.scheduledAt));if(scheduled<=this.ports.now())throw new AutomationError('INVALID_ARGUMENT','预约必须在未来');
  const observation=await this.provider.read(),card=observation.cards.find(x=>this.ports.digest(x.id)===p.cardKey);
  if(observation.source==='live'&&!this.allowLive())throw new AutomationError('LIVE_EFFECTS_NOT_AUTHORIZED','请先明确选择允许真实指定卡消费的来源；每笔仍需授权');
  if(!observation.verified||!card||card.status!=='available'||card.expiresAt&&Date.parse(card.expiresAt)<=scheduled)throw new AutomationError('CARD_UNAVAILABLE','指定卡片不可用或将在预约前过期');
  await this.ports.authorize(actor,'cards.consume');await this.ports.authorize(actor,'cards.manage');if(this.stopped||scheduled<=this.ports.now())throw new AutomationError('APPOINTMENT_MISSED','读取期间预约已错过');
  const replay=previous(this.store,actor.clientId,operation,key,p,this.ports);if(replay.result)return replay.result;
  const state=this.store.readAutomation();if(state.appointments.some(x=>x.accountBinding===observation.accountBinding&&(['uncertain','running'].includes(x.state)||x.creditId===card.id&&x.state==='pending')))throw new AutomationError('UNRESOLVED_CONSUMPTION','账号有未决消费或该卡已有预约，禁止换卡绕过');
  if(state.appointments.length>=10000)throw new AutomationError('CLIENT_LIMIT','预约记录达到上限');
  const at=new Date(this.ports.now()).toISOString(),item:Appointment={id:this.ports.newId(),source:observation.source,cardKey:String(p.cardKey),creditId:card.id,accountBinding:observation.accountBinding,consumeKey:this.ports.newId(),scheduledAt:new Date(scheduled).toISOString(),timeZone:String(p.timeZone),owner:actor,state:'pending',revision:1,outcome:null,reason:'scheduled',createdAt:at,updatedAt:at,calls:0};state.appointments.push(item);
  const result=commit(this.store,state,prior,appointmentView(item),this.event(item,operation));this.snapshot=observation;this.arm();return result;
 }
}
