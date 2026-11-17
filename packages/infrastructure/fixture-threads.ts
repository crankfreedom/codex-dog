import { ReadError } from '../modules/codex-readonly/ports.ts';
import type { CodexReadPort,GoalReadPort,ReadTool } from '../modules/codex-readonly/ports.ts';
export const fixtureThreadIds=Array.from({length:6},(_,index)=>`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`);
export class FixtureThreadProvider implements CodexReadPort {
  private running=false;
  private latest:(threadId:string)=>{turnId:string}|null;
  constructor(latest:(threadId:string)=>{turnId:string}|null=()=>null){this.latest=latest;}
  async start(){this.running=true;}
  connected(){return this.running;}
  discover(){return {candidates:[{candidateId:'fixture-only',selected:true}],selectionRequired:false};}
  async read(tool:ReadTool,params:Record<string,unknown>){
    if(!this.running)throw new ReadError('PROVIDER_UNAVAILABLE','模拟来源未启动');
    if(tool==='get_usage_limits')return {accountId:'fixture-only',ordinaryUsageAllowed:true,rateLimits:{primary:{usedPercent:25},secondary:{usedPercent:40}}};
    if(tool==='list_threads'){
      const start=params.cursor===undefined?0:Number(params.cursor);if(!Number.isInteger(start)||start<0||start>fixtureThreadIds.length)throw new ReadError('INVALID_ARGUMENT','模拟分页游标无效');
      const selected=params.archived?[]:fixtureThreadIds.slice(start,start+Number(params.limit));
      return {threads:selected.map((id,index)=>({id,kind:'codex',hostId:'local',status:index%2?'active':'idle'})),nextCursor:!params.archived&&start+selected.length<fixtureThreadIds.length?String(start+selected.length):null};
    }
    const id=String(params.threadId),index=fixtureThreadIds.indexOf(id);if(index<0)throw new ReadError('TARGET_IDENTITY_MISMATCH','模拟目标不存在');
    const delivered=this.latest(id),usageLimited=index===0||index===3;
    return {thread:{id,kind:'codex',hostId:'local',status:{type:delivered||usageLimited?'idle':index%2?'active':'idle',activeFlags:[]}},turns:[{id:delivered?.turnId??'fixture-turn-'+(index+1),status:delivered?'completed':usageLimited?'failed':index%2?'inProgress':'completed',...(!delivered&&usageLimited?{error:{codexErrorInfo:'usageLimitExceeded'}}:{})}]};
  }
  close(){this.running=false;}
}
export class FixtureGoalProvider implements GoalReadPort {
  private latest:(threadId:string)=>{turnId:string}|null;
  constructor(latest:(threadId:string)=>{turnId:string}|null=()=>null){this.latest=latest;}
  read(threadId:string){const index=fixtureThreadIds.indexOf(threadId);return index===2?{availability:'unknown' as const,current:null,reason:'fixture_unknown'}:{availability:'known' as const,current:index%2?{id:'fixture-goal-'+index,status:index===3&&this.latest(threadId)?'complete':'active'}:null,reason:null};}
}
