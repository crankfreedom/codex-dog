import {AutomationError} from '../automation/ports.ts';
import type {AutomationStorePort,AutomationPorts} from '../automation/ports.ts';
import type {ActorRef} from '../persistence/stage3-ports.ts';
import {previous,commit} from '../automation/mutations.ts';
import {inWindow} from '../automation/policy.ts';
export type NotificationKind='quota_recovered'|'task_completed'|'reset_result';
export class NotificationService {
 private store:AutomationStorePort;private ports:AutomationPorts;private show:(kind:NotificationKind)=>void;private schedule:(delay:number,run:()=>void)=>()=>void;private cancel?:()=>void;private stopped=true;
 constructor(store:AutomationStorePort,ports:AutomationPorts,show:NotificationService['show'],schedule:NotificationService['schedule']){this.store=store;this.ports=ports;this.show=show;this.schedule=schedule;}
 start(){this.stopped=false;this.arm();}
 private arm(){if(!this.stopped)this.cancel=this.schedule(1000,()=>{try{this.flush();}finally{this.arm();}});}
 close(){this.stopped=true;this.cancel?.();}
 flush(){const state=this.store.readAutomation(),settings=state.notifications,events=state.events.filter(x=>x.sequence>settings.cursor);if(!events.length)return;settings.cursor=events.at(-1)!.sequence;
  // 先提交去重游标；平台失败可漏提醒，不能导致业务回滚或重启重复轰炸。
  this.store.commitAutomation(state.version,state);if(!settings.enabled||!inWindow({prompt:'notification',mode:'observe',maxResumes:1,priority:'normal',expiresAt:null,dailyWindow:settings.dailyWindow},this.ports.now()))return;
  const kinds=new Set<NotificationKind>();for(const event of events){if(this.ports.now()-Date.parse(event.at)>30000)continue;if(event.reason==='observation_quota_recovered')kinds.add('quota_recovered');if(event.reason==='goal_completed')kinds.add('task_completed');if(['reset.succeeded','reset.uncertain','reset.missed','reset.failed'].includes(event.type))kinds.add('reset_result');}for(const kind of kinds)try{this.show(kind);}catch{}
 }
 async invoke(operation:string,p:Record<string,unknown>,actor:ActorRef,key?:string):Promise<Record<string,unknown>>{
  if(operation==='notifications.settings.get'){const {cursor,...settings}=this.store.readAutomation().notifications;return settings;}
  await this.ports.authorize(actor,'settings.manage');const old=previous(this.store,actor.clientId,operation,key,p,this.ports);if(old.result)return old.result;
  const state=this.store.readAutomation();if(state.notifications.revision!==p.expectedRevision)throw new AutomationError('REVISION_CONFLICT','通知修订已变化');Object.assign(state.notifications,p.patch);state.notifications.revision++;const {cursor,...result}=state.notifications;
  return commit(this.store,state,old,result,{resourceId:'notifications',at:new Date(this.ports.now()).toISOString(),type:operation,reason:'explicit',revision:result.revision});
 }
}
