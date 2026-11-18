import type {DeliveryGateReport,DeliveryGateCheck} from '../../contracts/delivery-gates.ts';
interface AccountObservation {verified:boolean;stale:boolean;connectionId:string;revision:number;accountBinding:string|null}
interface Metadata {availability:'known'|'unknown';reason:string;found:boolean;creatorAccountBinding:string|null;goal:{availability:'known'|'unknown';current:{id:string;status:string}|null};latestTurn:{id:string;status:string;firstUserItemId:string|null}|null}
interface LockObservation {lockAvailability:'free'|'held'|'unknown';reasons:string[]}
export interface DeliveryGatePorts {
 source:'fixture'|'live';now():number;account():AccountObservation;
 metadata(threadId:string):Metadata;
 locks(threadId:string):LockObservation|null;
}
/** An observation report cannot authorize dispatch. No domain state or provider calls are written here. */
export class DeliveryGateService {
 private ports:DeliveryGatePorts;
 constructor(ports:DeliveryGatePorts){this.ports=ports;}
 inspect(ref?:{connectionId:string;threadId:string}):DeliveryGateReport{
  const p=this.ports,checks:DeliveryGateCheck[]=[],add=(id:string,status:DeliveryGateCheck['status'],reason:string,source:DeliveryGateCheck['source']='local')=>checks.push({id,status,reason,source});
  if(p.source==='fixture'){add('delivery_gate_scope','not_checked','FIXTURE_IS_NOT_LIVE_GATE_EVIDENCE','fixture');return{status:'not_checked',checks,source:'fixture',observedAt:new Date(p.now()).toISOString(),readOnly:true,realSendingEnabled:false};}
  let account:AccountObservation|undefined;try{account=p.account();}catch{}
  const usable=account?.verified&&!account.stale&&!!account.accountBinding;
  add('delivery_account_observation',usable?'passed':'unknown',usable?'CURRENT_ACCOUNT_OBSERVED_ONLY':account?.stale?'ACCOUNT_OBSERVATION_EXPIRED':'ACCOUNT_OBSERVATION_UNAVAILABLE','live');
  if(!ref){add('delivery_target_metadata','not_checked','NO_TARGET_SELECTED');}
  else if(!account||ref.connectionId!==account.connectionId){add('delivery_target_metadata','blocked','CONNECTION_IDENTITY_CHANGED');}
  else{
   let metadata:Metadata|undefined;try{metadata=p.metadata(ref.threadId);}catch{}
   add('delivery_target_metadata',metadata?.availability==='known'?(metadata.found?'passed':'blocked'):'unknown',metadata?.availability==='known'?(metadata.found?'LOCAL_THREAD_METADATA_OBSERVED':'TARGET_METADATA_NOT_FOUND'):'TARGET_METADATA_UNAVAILABLE');
   if(metadata?.found){
    const creator=metadata.creatorAccountBinding;add('delivery_target_creator',creator&&usable?(creator===account.accountBinding?'passed':'blocked'):'unknown',creator&&usable?(creator===account.accountBinding?'CREATOR_MATCH_IS_NOT_EXECUTION_BINDING':'TARGET_CREATOR_ACCOUNT_MISMATCH'):'TARGET_CREATOR_OR_ACCOUNT_UNKNOWN');
    add('delivery_goal_relation',metadata.goal.availability==='known'?'passed':'unknown',metadata.goal.availability==='known'?(metadata.goal.current?'GOAL_THREAD_RELATION_OBSERVED':'NO_CURRENT_GOAL_METADATA'):'GOAL_METADATA_UNKNOWN');
    add('delivery_turn_metadata',metadata.latestTurn?'passed':'unknown',metadata.latestTurn?'PERSISTED_TURN_IS_NOT_LIVE_IDLE_STATE':'TURN_METADATA_UNAVAILABLE');
   }
   let lock:LockObservation|null|undefined;try{lock=p.locks(ref.threadId);}catch{}
   add('delivery_lock_snapshot',lock?(lock.lockAvailability==='free'?'passed':lock.lockAvailability==='held'?'blocked':'unknown'):lock===null?'not_checked':'unknown',lock===undefined?'LOCK_OBSERVATION_UNAVAILABLE':!lock?'LEGACY_LOCK_DIRECTORY_NOT_SELECTED':lock.lockAvailability==='free'?'LOCK_FREE_SNAPSHOT_IS_NOT_OWNERSHIP':lock.lockAvailability==='held'?'EXISTING_LOCK_RETAINED':'LOCK_IDENTITY_OR_FORMAT_UNVERIFIED');
  }
  add('delivery_target_execution_binding','unknown','TARGET_EXECUTION_ACCOUNT_PROOF_UNAVAILABLE');
  add('delivery_goal_execution_binding','unknown','GOAL_EXECUTION_ACCOUNT_PROOF_UNAVAILABLE');
  add('delivery_source_directory_binding','unknown','DESKTOP_CODEX_HOME_LINK_UNVERIFIED');
  add('delivery_live_target_state','unknown','LIVE_IDLE_APPROVAL_METADATA_UNAVAILABLE');
  add('delivery_unique_receipt','blocked','SENDER_HAS_NO_DURABLE_INTENT_CORRELATION');
  add('delivery_legacy_directory_binding','unknown','LEGACY_RUNTIME_DIRECTORY_UNVERIFIED');
  add('delivery_legacy_recovery','unknown','LEGACY_RECLAIM_POLICY_UNVERIFIED_REFERENCE_UNSAFE');
  add('delivery_atomic_exclusion','not_checked','READ_ONLY_NO_LOCK_ACQUIRED');
  return{status:checks.some(x=>x.status==='blocked')?'blocked':'unknown',checks,source:'live',observedAt:new Date(p.now()).toISOString(),readOnly:true,realSendingEnabled:false};
 }
}
