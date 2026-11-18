import type {DeliveryGateReport} from '../../contracts/delivery-gates.ts';
export interface DiagnosticCheck { id:string;status:'passed'|'blocked'|'unknown'|'not_checked';reason:string;source:'local'|'fixture'|'live' }
export function summarize(checks:DiagnosticCheck[]){return checks.some(x=>x.status==='blocked')?'blocked':checks.some(x=>x.status==='unknown')?'unknown':'passed';}
export class DiagnosticsService {
  private ports:{mode:()=>string;quota:()=>Record<string,unknown>;connection:()=>Record<string,unknown>;storage:()=>{integrity:string;schemaVersion:number};thread:(ref:Record<string,unknown>)=>Promise<Record<string,unknown>>;now:()=>number;deliveryGates?:(ref?:{connectionId:string;threadId:string})=>DeliveryGateReport};
  constructor(ports:DiagnosticsService['ports']){this.ports=ports;}
  async run(threadRef?:Record<string,unknown>,includeDeliveryGates=false){
    const mode=this.ports.mode();const source=mode==='fixture'?'fixture':'live';const checks:DiagnosticCheck[]=[];
    const check=(id:string,status:DiagnosticCheck['status'],reason:string,from:DiagnosticCheck['source']=source)=>checks.push({id,status,reason,source:from});
    try{const db=this.ports.storage();check('database',db.integrity==='ok'?'passed':'blocked',db.integrity==='ok'?'database_integrity_ok':'database_integrity_failed','local');}catch{check('database','unknown','STORAGE_FAILURE','local');}
    const connection=this.ports.connection();check('connection',mode==='fixture'?'not_checked':connection.state==='ready'?'passed':'unknown',mode==='fixture'?'fixture_mode':connection.state==='ready'?'provider_ready':String(connection.reason??'PROVIDER_UNAVAILABLE'));
    try{const quota=this.ports.quota();check('quota',quota.stale||quota.available==null?'unknown':quota.available===false?'blocked':'passed',String(quota.reason??'quota_unknown'));}catch(error){check('quota','unknown',this.code(error));}
    if(includeDeliveryGates&&source==='live'){check('thread','not_checked','METADATA_GATE_REPLACES_THREAD_CONTENT_API');check('goal','not_checked','METADATA_GATE_REPLACES_GOAL_API');}
    else if(!threadRef){check('thread','not_checked','no_target_selected');check('goal','not_checked','no_target_selected');}
    else try{
      const thread=await this.ports.thread(threadRef);check('thread',thread.statusKnown===true?'passed':'unknown',thread.statusKnown===true?'target_identity_verified':'thread_status_unknown');
      const goal=thread.goal as {availability?:string;current?:unknown};check('goal',goal?.availability==='known'?'passed':'unknown',goal?.availability==='known'?(goal.current===null?'no_current_goal':'goal_identity_observed'):'goal_unknown');
    }catch(error){check('thread','unknown',this.code(error));check('goal','not_checked','target_read_failed');}
    check('goal_account_binding','not_checked','cross_source_binding_unverified');check('automation',mode==='fixture'?'passed':'not_checked',mode==='fixture'?'fixture_automation_only':'TARGET_BINDING_UNVERIFIED','local');
    const deliveryGates=includeDeliveryGates?this.ports.deliveryGates?.(threadRef as {connectionId:string;threadId:string}|undefined):undefined;
    if(includeDeliveryGates){if(deliveryGates)checks.push(...deliveryGates.checks);else check('delivery_gate_scope','unknown','DELIVERY_GATE_PORT_UNAVAILABLE','local');}
    return {status:summarize(checks),checks,mode,source,observedAt:new Date(this.ports.now()).toISOString(),stale:false,completionConfirmed:false,readOnly:true,...(deliveryGates?{deliveryGates}:{})};
  }
  private code(error:unknown){return error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'&&/^[A-Z_]{1,80}$/.test(error.code)?error.code:'PROVIDER_UNAVAILABLE';}
}
