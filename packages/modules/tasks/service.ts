import { taskConfigSchema } from '../../contracts/automation.ts';
import { AutomationError,taskView,unresolved } from '../automation/ports.ts';
import type { AutomationStorePort,AutomationPorts,Task,Binding } from '../automation/ports.ts';
import type { ActorRef } from '../persistence/stage3-ports.ts';
import { previous,commit,findTask } from '../automation/mutations.ts';
import {page} from '../automation/paging.ts';
export class TaskService {
  private store:AutomationStorePort;private ports:AutomationPorts;
  constructor(store:AutomationStorePort,ports:AutomationPorts){this.store=store;this.ports=ports;}
  private async bind(task:Pick<Task,'config'|'threadRef'>,p:Record<string,unknown>,actor:ActorRef):Promise<{binding:Binding|null;source:'fixture'|'live'}>{
    const observation=await this.ports.observe(task.threadRef);
    if(observation.completionConfirmed)throw new AutomationError('TASK_COMPLETED','该目标已被可信证据确认完成');
    if(!observation.known||!observation.goalKnown)throw new AutomationError('TARGET_STATE_UNKNOWN','目标或 Goal 状态不能确认');
    if(task.config.mode==='observe')return {binding:null,source:observation.source};
    await this.ports.authorize(actor,'messages.send');const auth=p.authorization as Record<string,unknown>|undefined;
    if(!auth||auth.allowAutomaticSend!==true)throw new AutomationError('BUSINESS_AUTH_REQUIRED','必须明确批准当前目标和修订的自动发送');
    if(observation.source==='live')throw new AutomationError('TARGET_BINDING_UNVERIFIED','真实账号/目标及旧锁门禁未通过');
    if(!observation.known||!observation.goalKnown||observation.approval)throw new AutomationError('TARGET_STATE_UNKNOWN','目标或 Goal 状态不能确认');
    if(observation.binding.connectionRevision!==auth.connectionRevision||observation.binding.goalId!==auth.expectedGoalId||observation.binding.latestTurnId!==auth.expectedLatestTurnId)throw new AutomationError('REVISION_CONFLICT','当前连接、Goal 或轮次与授权不同');
    return {binding:observation.binding,source:observation.source};
  }
  async invoke(operation:string,p:Record<string,unknown>,actor:ActorRef,key?:string):Promise<Record<string,unknown>>{
    const content=p.includeContent===true;if(content)await this.ports.authorize(actor,'content.read');
    if(['tasks.list','archives.list'].includes(operation)){const state=this.store.readAutomation(),all=state.tasks.filter(x=>x.archived===(operation==='archives.list')&&(!p.reason||x.reason===p.reason));const rows=all.map(task=>({sequence:state.events.findLast(x=>x.resourceId===task.id&&(operation==='archives.list'?['tasks.remove','task.completed'].includes(x.type):x.type==='tasks.create'))?.sequence??0,value:taskView(task)})).sort((a,b)=>a.sequence-b.sequence);return page(this.store,this.ports,operation,{reason:p.reason??null},rows,p);}
    if(['tasks.get','archives.get','tasks.policy.get','tasks.revisions.list','timelines.get'].includes(operation)){
      const state=this.store.readAutomation(),task=['timelines.get','tasks.revisions.list'].includes(operation)?state.tasks.find(x=>x.id===p.id):findTask(state,String(p.id),operation==='archives.get');if(!task)throw new AutomationError('RESOURCE_NOT_FOUND','任务不存在');
      if(operation==='tasks.revisions.list')return page(this.store,this.ports,operation,{id:p.id},task.revisions.map(x=>({sequence:x.revision,value:x})),p);
      if(operation==='timelines.get')return page(this.store,this.ports,operation,{id:p.id},state.events.filter(x=>x.resourceId===p.id).map(x=>({sequence:x.sequence,value:x})),p);
      if(operation==='tasks.policy.get')return {id:task.id,revision:task.revision,policy:(({prompt,...policy})=>policy)(task.config),resumeCount:task.resumeCount,authorization:taskView(task).authorization};
      return taskView(task,content);
    }
    await this.ports.authorize(actor,'tasks.manage');const prior=previous(this.store,actor.clientId,operation,key,p,this.ports);if(prior.result)return prior.result;
    const before=this.store.readAutomation();let task:Task;
    let binding:Binding|null=null;let boundSource:Task['source']='unknown';
    if(operation==='tasks.create'){
      let body=p.prompt;
      if(p.templateRef){const ref=p.templateRef as {templateId:string;revision:number};const template=before.templates.find(x=>x.id===ref.templateId&&!x.deleted&&x.revision===ref.revision);if(!template)throw new AutomationError('REVISION_CONFLICT','模板修订已变化');body=template.body;}
      task={id:this.ports.newId(),source:'unknown',threadRef:p.threadRef as Task['threadRef'],config:taskConfigSchema.parse({prompt:body,mode:p.mode,maxResumes:p.maxResumes,priority:p.priority,expiresAt:p.expiresAt,dailyWindow:p.dailyWindow}),revision:1,resumeCount:0,enabled:false,phase:'suspended',reason:'created_paused',order:before.tasks.length,archived:false,owner:actor,authorization:null,revisions:[]};
      const observed=await this.ports.observe(task.threadRef);if(observed.completionConfirmed)throw new AutomationError('TASK_COMPLETED','已确认完成的目标不能新建托管');if(!observed.known)throw new AutomationError('TARGET_STATE_UNKNOWN','无法确认创建目标身份');task.source=observed.source;
      if(p.enabled){const verified=await this.bind(task,p,actor);binding=verified.binding;task.source=verified.source;}
    }else{task=findTask(before,String(p.id));if(operation==='tasks.enable'){if(task.revision!==p.confirmedRevision)throw new AutomationError('REVISION_CONFLICT','请确认当前任务修订');const verified=await this.bind({...task,threadRef:{...task.threadRef,connectionId:String(p.connectionId??task.threadRef.connectionId)}},p,actor);binding=verified.binding;boundSource=verified.source;}}
    await this.ports.authorize(actor,'tasks.manage');if(binding)await this.ports.authorize(actor,'messages.send');
    const state=this.store.readAutomation();
    const replay=previous(this.store,actor.clientId,operation,key,p,this.ports);if(replay.result)return replay.result;
    // Only create/enable carry provider observations from the earlier snapshot.
    // Pause/edit/remove recheck the current task, unresolved attempts and revision below;
    // an unrelated notification cursor must not invalidate these local mutations.
    if(['tasks.create','tasks.enable'].includes(operation)&&state.version!==before.version)throw new AutomationError('REVISION_CONFLICT','核验期间业务状态变化，请重新读取');
    const at=new Date(this.ports.now()).toISOString();
    if(operation==='tasks.create'){
      if(state.tasks.length>=1000)throw new AutomationError('CLIENT_LIMIT','任务数量达到上限');
      if(state.tasks.some(x=>!x.archived&&x.threadRef.threadId===task.threadRef.threadId))throw new AutomationError('TARGET_MANAGED','该目标已有托管任务');
      if(unresolved(state,task.threadRef.threadId))throw new AutomationError('UNRESOLVED_ATTEMPT','该目标仍有未决投递，禁止重建绕过');
      task.enabled=p.enabled===true;task.authorization=binding;task.phase=task.enabled?'observing':'suspended';task.reason=task.enabled?'enabled':'created_paused';task.revisions.push({revision:1,at});state.tasks.push(task);
    }else{
      task=findTask(state,String(p.id));
      if(operation==='tasks.pause'){task.enabled=false;task.reason='paused';task.authorization=null;if(!unresolved(state,task.threadRef.threadId))task.phase='suspended';}
      else if(operation==='tasks.enable'){if(unresolved(state,task.threadRef.threadId))throw new AutomationError('UNRESOLVED_ATTEMPT','请先核对未决投递');task.threadRef.connectionId=String(p.connectionId??task.threadRef.connectionId);task.source=boundSource;task.enabled=true;task.authorization=binding;task.owner=actor;task.phase='observing';task.reason='enabled';}
      else if(operation==='tasks.update'||operation==='tasks.remove'){
        if(task.enabled)throw new AutomationError('TASK_MUST_PAUSE','请先暂停任务');
        if(unresolved(state,task.threadRef.threadId))throw new AutomationError('UNRESOLVED_ATTEMPT','存在未决投递，不能编辑或移除');
        if(task.revision!==p.expectedRevision)throw new AutomationError('REVISION_CONFLICT','任务修订已变化');
        if(operation==='tasks.update'){task.config=taskConfigSchema.parse({...task.config,...p.patch as object});if(task.config.maxResumes<task.resumeCount)throw new AutomationError('RESUME_LIMIT','上限不能小于累计次数');task.revision++;task.revisions.push({revision:task.revision,at});task.authorization=null;task.phase='suspended';task.reason='edited_paused';}
        else{task.archived=true;task.reason='removed';task.authorization=null;}
      }else throw new AutomationError('CAPABILITY_UNSUPPORTED','任务操作不存在');
    }
    return commit(this.store,state,prior,taskView(task),{resourceId:task.id,at,type:operation,reason:task.reason,revision:task.revision});
  }
}
