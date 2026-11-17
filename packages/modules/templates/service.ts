import { AutomationError,templateView } from '../automation/ports.ts';
import type { AutomationStorePort,AutomationPorts } from '../automation/ports.ts';
import type { ActorRef } from '../persistence/stage3-ports.ts';
import { previous,commit } from '../automation/mutations.ts';
import {page} from '../automation/paging.ts';
export class TemplateService {
  private store:AutomationStorePort;private ports:AutomationPorts;
  constructor(store:AutomationStorePort,ports:AutomationPorts){this.store=store;this.ports=ports;}
  async invoke(operation:string,p:Record<string,unknown>,actor:ActorRef,key?:string):Promise<Record<string,unknown>>{
    const content=p.includeContent===true;if(content)await this.ports.authorize(actor,'content.read');
    if(operation==='templates.list'){const all=this.store.readAutomation().templates.map((value,index)=>({sequence:index+1,value})).filter(x=>!x.value.deleted);return page(this.store,this.ports,operation,{},all.map(x=>({...x,value:templateView(x.value)})),p);}
    if(operation==='templates.get'){const item=this.store.readAutomation().templates.find(x=>x.id===p.id&&!x.deleted);if(!item)throw new AutomationError('RESOURCE_NOT_FOUND','模板不存在');return templateView(item,content);}
    await this.ports.authorize(actor,'tasks.manage');
    const prior=previous(this.store,actor.clientId,operation,key,p,this.ports);if(prior.result)return prior.result;
    if(operation==='templates.create'&&p.copyOfId)await this.ports.authorize(actor,'content.read');
    await this.ports.authorize(actor,'tasks.manage');
    const replay=previous(this.store,actor.clientId,operation,key,p,this.ports);if(replay.result)return replay.result;
    const state=this.store.readAutomation();let item=state.templates.find(x=>x.id===p.id&&!x.deleted);
    if(operation==='templates.create'){
      if(state.templates.length>=1000)throw new AutomationError('CLIENT_LIMIT','模板数量达到上限');
      const source=p.copyOfId?state.templates.find(x=>x.id===p.copyOfId&&!x.deleted):undefined;
      if(p.copyOfId&&(!source||source.revision!==p.expectedSourceRevision))throw new AutomationError('REVISION_CONFLICT','复制来源修订已变化');
      item={id:this.ports.newId(),name:String(p.name),body:source?.body??String(p.body),revision:1,isDefault:!state.templates.some(x=>x.isDefault&&!x.deleted),deleted:false};state.templates.push(item);
    }else{
      if(!item)throw new AutomationError('RESOURCE_NOT_FOUND','模板不存在');
      if(item.revision!==p.expectedRevision)throw new AutomationError('REVISION_CONFLICT','模板修订已变化');
      if(operation==='templates.update')Object.assign(item,p.patch);
      else if(operation==='templates.delete'){item.deleted=true;item.isDefault=false;}
      else if(operation==='templates.setDefault'){for(const other of state.templates)other.isDefault=other===item;}
      else throw new AutomationError('CAPABILITY_UNSUPPORTED','模板操作不存在');
      item.revision++;
    }
    return commit(this.store,state,prior,templateView(item),{resourceId:item.id,at:new Date(this.ports.now()).toISOString(),type:operation,reason:'explicit',revision:item.revision});
  }
}
