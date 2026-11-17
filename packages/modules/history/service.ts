import { eventQuery,eventExport } from '../../contracts/stage3.ts';
import { Stage3Error } from '../persistence/stage3-ports.ts';
import type { Stage3StorePort,ActorRef,ExportOperation,HistoryFilter } from '../persistence/stage3-ports.ts';
export interface CursorPayload { version:1;boundary:number;after:number;filterHash:string }
export interface ExportSink { append(text:string):Promise<void>;publish():Promise<string>;complete():Promise<void>;discard():Promise<void> }
export interface ExportFiles { start():Promise<void>;recover(operations:ExportOperation[]):Promise<void>;open(id:string,output?:string):Promise<ExportSink> }
export class HistoryService {
  private store:Stage3StorePort;private files:ExportFiles;private options:{now:()=>number;newId:()=>string;digest:(value:string)=>string;encode:(payload:CursorPayload)=>string;decode:(value:string)=>CursorPayload;authorize:(actor:ActorRef)=>Promise<void>;yield:()=>Promise<void>};
  private stopped=true;private jobs=new Map<string,Promise<void>>();
  constructor(store:Stage3StorePort,files:ExportFiles,options:HistoryService['options']){this.store=store;this.files=files;this.options=options;}
  async start(){await this.files.start();const interrupted=this.store.recoverExports(this.at());await this.files.recover(interrupted);this.stopped=false;}
  private at(){return new Date(this.options.now()).toISOString();}
  private filter(value:HistoryFilter):HistoryFilter{return {...(value.from?{from:new Date(value.from).toISOString()}:{}),...(value.to?{to:new Date(value.to).toISOString()}:{}),...(value.type?{type:value.type}:{}),...(value.reason?{reason:value.reason}:{})};}
  query(raw:unknown){
    const parsed=eventQuery.safeParse(raw);if(!parsed.success)throw new Stage3Error('INVALID_ARGUMENT','历史查询参数无效');
    const input=parsed.data;const filter=this.filter(input);const filterHash=this.options.digest(JSON.stringify(filter));let boundary=this.store.eventBoundary(),after=0;
    if(input.cursor){const cursor=this.options.decode(input.cursor);if(cursor.filterHash!==filterHash)throw new Stage3Error('INVALID_ARGUMENT','游标不属于当前查询条件');boundary=cursor.boundary;after=cursor.after;}
    const rows=this.store.eventPage(filter,boundary,after,input.limit+1);const more=rows.length>input.limit;const items=rows.slice(0,input.limit);
    return {items,boundary,nextCursor:more?this.options.encode({version:1,boundary,after:items.at(-1)!.sequence,filterHash}):null,source:'local',observedAt:this.at(),stale:false};
  }
  view(operation:ExportOperation){const {actor,owner,targetName,...safe}=operation;return safe;}
  get(id:string,owner:string,allowAll=false){return this.view(this.store.getExport(id,owner,allowAll));}
  list(owner:string,limit:number,allowAll=false){return {items:this.store.listExports(owner,limit,allowAll).map(x=>this.view(x))};}
  async export(raw:unknown,actor:ActorRef,key:string|undefined){
    if(this.stopped)throw new Stage3Error('APP_STOPPING','历史服务正在退出');
    const parsed=eventExport.safeParse(raw);if(!parsed.success)throw new Stage3Error('INVALID_ARGUMENT','导出条件或文件名无效');
    if(!key)throw new Stage3Error('INVALID_ARGUMENT','导出必须携带幂等键');
    await this.options.authorize(actor);const input=parsed.data;
    const id=this.options.newId();const operation=this.store.createExport({id,actor,key,digest:this.options.digest(JSON.stringify({...this.filter(input),limit:input.limit,output:input.output??null})),at:this.at(),boundary:this.store.eventBoundary(),targetName:input.output??id+'.jsonl'});
    if(operation.state==='accepted'&&!this.jobs.has(operation.id)){const task=this.run(operation,input);this.jobs.set(operation.id,task);void task.finally(()=>this.jobs.delete(operation.id)).catch(()=>{});}
    return this.view(operation);
  }
  async cancel(id:string,actor:ActorRef,key:string|undefined){if(!key)throw new Stage3Error('INVALID_ARGUMENT','取消必须携带幂等键');await this.options.authorize(actor);return this.view(this.store.cancelExport(id,actor.clientId,key,actor.kind==='desktop'||actor.canManageOperations===true));}
  private async guard(operation:ExportOperation){if(this.stopped)throw new Stage3Error('APP_STOPPING','应用正在退出');if(this.store.getExport(operation.id,operation.owner).cancelRequested)throw new Stage3Error('CANCELLED','导出已取消');await this.options.authorize(operation.actor);}
  private async run(operation:ExportOperation,input:ReturnType<typeof eventExport.parse>){
    let sink:ExportSink|undefined;
    try{
      await this.options.yield();await this.guard(operation);operation={...operation,state:'running',updatedAt:this.at()};this.store.saveExport(operation);sink=await this.files.open(operation.id,input.output);
      let after=0;const filter=this.filter(input);
      while(operation.written<input.limit){
        await this.guard(operation);const rows=this.store.eventPage(filter,operation.boundary,after,Math.min(100,input.limit-operation.written));if(!rows.length)break;
        await sink.append(rows.map(x=>JSON.stringify(x)+'\n').join(''));operation={...operation,written:operation.written+rows.length,updatedAt:this.at()};after=rows.at(-1)!.sequence;this.store.saveExport(operation);await this.options.yield();
      }
      await this.guard(operation);const fileName=await sink.publish();await this.guard(operation);this.store.saveExport({...operation,state:'succeeded',fileName,updatedAt:this.at()});await sink.complete();
    }catch(error){
      const code=error instanceof Stage3Error?error.code:'STORAGE_FAILURE';
      try{await sink?.discard();}catch{this.store.saveExport({...operation,state:'failed',updatedAt:this.at(),error:'STORAGE_FAILURE'});return;}
      const known=['AUTH_REVOKED','APP_STOPPING','EXPORT_TARGET_EXISTS'].includes(code)?code:code==='CANCELLED'?'cancelled':'STORAGE_FAILURE';
      this.store.saveExport({...operation,state:code==='CANCELLED'||code==='APP_STOPPING'||code==='AUTH_REVOKED'?'cancelled':'failed',fileName:null,updatedAt:this.at(),error:known});
    }
  }
  async close(){this.stopped=true;await Promise.allSettled(this.jobs.values());}
}
