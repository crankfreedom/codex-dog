export interface ActorRef { kind:'desktop'|'external'; clientId:string; revision:number;canManageOperations?:boolean }
export interface SettingView { section:'appearance'|'monitoring'; revision:number; values:Record<string,unknown> }
export interface HistoryFilter { from?:string;to?:string;type?:string;reason?:string }
export interface HistoryEvent { sequence:number;at:string;type:string;reason:string;source:'local';revision:number|null }
export interface ExportOperation { id:string;kind:'events.export';owner:string;state:'accepted'|'running'|'succeeded'|'failed'|'cancelled';createdAt:string;updatedAt:string;boundary:number;written:number;fileName:string|null;error:string|null;actor:ActorRef;cancelRequested:boolean;targetName:string }
export interface Stage3StorePort {
  readSetting(section:SettingView['section']):SettingView;
  commitSetting(input:{section:SettingView['section'];expectedRevision:number;values:Record<string,unknown>;owner:string;key:string;digest:string;at:string}):SettingView;
  appendRuntime(type:'runtime.started'|'runtime.stopping',mode:'fixture'|'live-readonly',at:string):void;
  eventBoundary():number;
  eventPage(filter:HistoryFilter,boundary:number,after:number,limit:number):HistoryEvent[];
  cursorKey():string;
  createExport(input:{id:string;actor:ActorRef;key:string;digest:string;at:string;boundary:number;targetName:string}):ExportOperation;
  getExport(id:string,owner:string,allowAll?:boolean):ExportOperation;
  listExports(owner:string,limit:number,allowAll?:boolean):ExportOperation[];
  saveExport(operation:ExportOperation):void;
  cancelExport(id:string,owner:string,key:string,allowAll?:boolean):ExportOperation;
  recoverExports(at:string):ExportOperation[];
}
export class Stage3Error extends Error { code:string;constructor(code:string,message:string){super(message);this.code=code;} }
