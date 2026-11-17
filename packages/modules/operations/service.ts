import type {AutomationStorePort,AutomationPorts,BackgroundOperation} from '../automation/ports.ts';
import {AutomationError} from '../automation/ports.ts';
import type {ActorRef} from '../persistence/stage3-ports.ts';
import {previous,commit} from '../automation/mutations.ts';
export function backgroundView(item:BackgroundOperation){const {owner,...view}=item;return view;}
export class OperationService {
 private store:AutomationStorePort;private ports:AutomationPorts;
 constructor(store:AutomationStorePort,ports:AutomationPorts){this.store=store;this.ports=ports;}
 private allowed(item:BackgroundOperation,actor:ActorRef){return item.owner===actor.clientId||actor.kind==='desktop'||actor.canManageOperations===true;}
 owns(id:string,actor:ActorRef){return this.store.readAutomation().backgroundOperations.some(x=>x.id===id&&this.allowed(x,actor));}
 list(actor:ActorRef,limit:number){return this.store.readAutomation().backgroundOperations.filter(x=>this.allowed(x,actor)).slice(-limit).reverse().map(backgroundView);}
 async invoke(operation:string,p:Record<string,unknown>,actor:ActorRef,key?:string):Promise<Record<string,unknown>>{
  const state=this.store.readAutomation(),item=state.backgroundOperations.find(x=>x.id===p.id&&this.allowed(x,actor));if(!item)throw new AutomationError('OPERATION_NOT_FOUND','没有该调用方可管理的业务操作');
  if(operation==='operations.get')return backgroundView(item);
  await this.ports.authorize(actor,'tasks.manage');const old=previous(this.store,actor.clientId,operation,key,p,this.ports);if(old.result)return old.result;
  if(item.state!=='accepted')throw new AutomationError('OPERATION_IRREVERSIBLE','已开始或完成的调度不能撤回；请暂停相应任务');
  item.state='cancelled';item.updatedAt=new Date(this.ports.now()).toISOString();item.error='CANCELLED';return commit(this.store,state,old,backgroundView(item),{resourceId:item.id,at:item.updatedAt,type:'operation.cancelled',reason:'explicit',revision:null});
 }
}
