import type { TaskConfig } from '../../contracts/automation.ts';
import type { ActorRef } from '../persistence/stage3-ports.ts';
import type {Appointment} from '../cards/ports.ts';

export type AutomationScope = 'read'|'content.read'|'tasks.manage'|'messages.send'|'cards.manage'|'cards.consume'|'settings.manage';
export interface Template {id:string;name:string;body:string;revision:number;isDefault:boolean;deleted:boolean}
export interface Binding {connectionRevision:number;accountBinding:string;goalId:string|null;latestTurnId:string|null}
export interface Task {id:string;source:'fixture'|'live'|'unknown';threadRef:{connectionId:string;threadId:string};config:TaskConfig;revision:number;resumeCount:number;enabled:boolean;phase:string;reason:string;order:number;archived:boolean;owner:ActorRef;authorization:Binding|null;revisions:Array<{revision:number;at:string}>}
export interface AutomationEvent {sequence:number;resourceId:string;at:string;type:string;reason:string;revision:number|null}
export interface LeaseRecord {target:string;token:string;pid:number}
export interface BackgroundOperation {id:string;owner:string;kind:'scheduler.runNow';state:'accepted'|'running'|'succeeded'|'failed'|'cancelled';createdAt:string;updatedAt:string;error:string|null;resultCount:number|null}
export interface Attempt {id:string;source:'fixture'|'live'|'unknown';taskId:string|null;threadRef:Task['threadRef'];marker:string;prompt:string;taskRevision:number|null;binding:Binding;owner:ActorRef;lease:LeaseRecord|null;state:'prepared'|'dispatching'|'submitted'|'receipt_matched'|'turn_finished'|'uncertain'|'cancelled_before_write';slot:'held'|'released';submitted:boolean;receiptMatched:boolean;turnId:string|null;reason:string;createdAt:string}
export interface AutomationState {version:number;templates:Template[];tasks:Task[];attempts:Attempt[];appointments:Appointment[];backgroundOperations:BackgroundOperation[];notifications:{revision:number;enabled:boolean;dailyWindow:TaskConfig['dailyWindow'];cursor:number};queue:{revision:number;enabled:boolean;limit:number};scheduler:{revision:number;enabled:boolean;pollSeconds:number};events:AutomationEvent[];operations:Array<{scope:string;digest:string;result:Record<string,unknown>}>}
export interface AutomationStorePort {
  readAutomation():AutomationState;
  commitAutomation(expectedVersion:number,state:AutomationState,event?:Omit<AutomationEvent,'sequence'>):void;
  cursorKey():string;
}
export interface TargetObservation {binding:Binding;known:boolean;idle:boolean;approval:boolean;goalKnown:boolean;completionConfirmed:boolean;source:'fixture'|'live';reason:string}
export interface AutomationPorts {now():number;newId():string;digest(value:string):string;authorize(actor:ActorRef,scope:AutomationScope):Promise<void>;observe(ref:Task['threadRef']):Promise<TargetObservation>;quota?():Promise<{available:boolean|null;stale:boolean}>;peekQuota?():{available:boolean|null;stale:boolean}}
export interface DeliveryPorts extends AutomationPorts {
  quota():Promise<{available:boolean|null;stale:boolean}>;
  eligibility(ref:Task['threadRef']):Promise<{quotaError:boolean;latestTurnId:string|null;goalActive:boolean}>;
  lease:{acquire(target:string):LeaseRecord;assertOwned(lease:LeaseRecord):void;release(lease:LeaseRecord):void;releaseRecorded?(lease:LeaseRecord):void};
  dispatch(attempt:Attempt,finalGuard:()=>Promise<void>):Promise<{outcome:'submitted'|'not_written'|'uncertain';turnId:string|null}>;
  receipt(attempt:Attempt):Promise<{matched:boolean;turnId:string|null;turnFinished:boolean;goalComplete:boolean}>;
}
export class AutomationError extends Error {code:string;constructor(code:string,message:string){super(message);this.code=code;}}
export function taskView(task:Task,content=false):Record<string,unknown>{return {id:task.id,source:task.source,threadRef:task.threadRef,...task.config,prompt:content?task.config.prompt:null,revision:task.revision,resumeCount:task.resumeCount,enabled:task.enabled,phase:task.phase,reason:task.reason,order:task.order,archived:task.archived,authorization:task.authorization?{bound:true,connectionRevision:task.authorization.connectionRevision,goalId:task.authorization.goalId}:null};}
export function templateView(template:Template,content=false):Record<string,unknown>{return {id:template.id,name:template.name,body:content?template.body:null,revision:template.revision,isDefault:template.isDefault,deleted:template.deleted};}
export function attemptView(attempt:Attempt):Record<string,unknown>{const {prompt,owner,binding,marker,lease,...view}=attempt;return view;}
export function unresolved(state:AutomationState,threadId:string){return state.attempts.some(x=>x.threadRef.threadId===threadId&&x.slot==='held');}
