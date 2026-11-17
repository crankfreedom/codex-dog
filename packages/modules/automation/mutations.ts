import { AutomationError } from './ports.ts';
import type { AutomationStorePort,AutomationPorts,AutomationEvent,AutomationState } from './ports.ts';
export function previous(store:AutomationStorePort,owner:string,operation:string,key:string|undefined,params:unknown,ports:AutomationPorts){
  if(!key)throw new AutomationError('INVALID_ARGUMENT','变更必须携带持久幂等键');
  const scope=JSON.stringify([owner,operation,key]),digest=ports.digest(JSON.stringify(params));
  const old=store.readAutomation().operations.find(x=>x.scope===scope);
  if(old&&old.digest!==digest)throw new AutomationError('IDEMPOTENCY_CONFLICT','同键参数不同');
  return {scope,digest,result:old?.result};
}
export function commit(store:AutomationStorePort,state:AutomationState,record:ReturnType<typeof previous>,result:Record<string,unknown>,event:Omit<AutomationEvent,'sequence'>){
  if(state.operations.length>=10000)throw new AutomationError('CLIENT_LIMIT','业务幂等记录达到上限，拒绝删除旧真值');
  state.operations.push({scope:record.scope,digest:record.digest,result});store.commitAutomation(state.version,state,event);return result;
}
export function findTask(state:AutomationState,id:string,archived=false){const task=state.tasks.find(x=>x.id===id&&x.archived===archived);if(!task)throw new AutomationError('RESOURCE_NOT_FOUND','任务不存在');return task;}
