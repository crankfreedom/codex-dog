import {connect} from 'node:net';
import type {Socket} from 'node:net';
import {z} from 'zod';
import {AutomationError} from '../modules/automation/ports.ts';
import type {Attempt,DeliveryPorts} from '../modules/automation/ports.ts';

export interface CodexMessageDispatchOptions {
  pipe:string;
  callerThreadId:string;
  timeoutMs?:number;
  maxFrameBytes?:number;
  socketFactory?:(pipe:string)=>Socket;
}
const uuid=z.string().uuid();
const explicitPipe=/^\\\\\.\\pipe\\codex-app-tools-[a-zA-Z0-9-]{1,100}$/;
const safeError=(code:string)=>new AutomationError(code,code==='APP_STOPPING'?'投递连接正在关闭':'投递来源不可用或协议不兼容');
const fixedTool='send_message_to_thread';
const fixedNamespace='codex_app';
const stringProperty=z.object({type:z.literal('string')}).passthrough();
const toolSchema=z.object({
  name:z.literal(fixedTool),namespace:z.literal(fixedNamespace),inputSchema:z.object({
    type:z.literal('object'),additionalProperties:z.literal(false),
    properties:z.object({threadId:stringProperty,prompt:stringProperty,hostId:stringProperty}).passthrough(),
    required:z.array(z.string()).refine(fields=>fields.length===2&&fields.includes('threadId')&&fields.includes('prompt')),
  }).passthrough(),
}).passthrough();
const toolResult=z.object({success:z.literal(true),contentItems:z.array(z.object({type:z.literal('inputText'),text:z.string().max(1024*1024)}).strict()).length(1)}).strict();

class DispatchSession {
  private options:CodexMessageDispatchOptions;
  private socket?:Socket;
  private buffer=Buffer.alloc(0);
  private received=0;
  private pending?:{id:number;resolve(value:unknown):void;reject(error:Error):void};
  private startup?:{resolve():void;reject(error:Error):void};
  private error?:AutomationError;
  private stopped=false;
  private timer?:NodeJS.Timeout;
  private sequence=0;
  private closing?:Promise<void>;
  private closed=false;
  written=false;
  constructor(options:CodexMessageDispatchOptions){this.options=options;}
  async open(){
    try{this.socket=this.options.socketFactory?this.options.socketFactory(this.options.pipe):connect(this.options.pipe);}catch{throw safeError('PROVIDER_UNAVAILABLE');}
    const socket=this.socket;
    socket.on('data',data=>this.receive(data));socket.on('error',()=>this.fail('PROVIDER_UNAVAILABLE'));socket.once('close',()=>{this.closed=true;this.fail('PROVIDER_UNAVAILABLE');});
    this.timer=setTimeout(()=>{this.fail('READ_TIMEOUT');socket.destroy();},this.options.timeoutMs??15000);
    await new Promise<void>((resolve,reject)=>{this.startup={resolve,reject};socket.once('connect',()=>{this.startup=undefined;resolve();});if(this.error){this.startup=undefined;reject(this.error);}});
  }
  private fail(code:string){this.error??=safeError(code);const startup=this.startup,pending=this.pending;this.startup=undefined;this.pending=undefined;startup?.reject(this.error);pending?.reject(this.error);}
  private receive(data:Buffer){
    if(this.stopped||this.error)return;
    const limit=this.options.maxFrameBytes??2*1024*1024;this.received+=data.length;
    if(this.received>limit*4){this.fail('PROVIDER_SCHEMA_UNSUPPORTED');return;}
    this.buffer=Buffer.concat([this.buffer,data]);
    while(this.buffer.length>=4){
      const size=this.buffer.readUInt32LE(0);if(size===0||size>limit){this.fail('PROVIDER_SCHEMA_UNSUPPORTED');return;}
      if(this.buffer.length<size+4)return;
      let message:unknown;try{message=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(this.buffer.subarray(4,size+4)));}catch{this.fail('PROVIDER_SCHEMA_UNSUPPORTED');return;}
      this.buffer=this.buffer.subarray(size+4);
      if(!message||typeof message!=='object'||Array.isArray(message)){this.fail('PROVIDER_SCHEMA_UNSUPPORTED');return;}
      const raw=message as Record<string,unknown>;if(!this.pending||raw.id!==this.pending.id)continue;
      if(raw.error!==undefined||!Object.hasOwn(raw,'result')){this.fail('PROVIDER_UNAVAILABLE');return;}
      const pending=this.pending;this.pending=undefined;pending.resolve(raw.result);
    }
  }
  private writable(){if(this.stopped||this.error)throw this.error??safeError('APP_STOPPING');if(!this.socket||this.socket.destroyed||!this.socket.writable)throw safeError('PROVIDER_UNAVAILABLE');}
  request(method:'tools/list'|'tools/call',params:Record<string,unknown>):Promise<unknown>{
    this.writable();if(this.pending)throw safeError('PROVIDER_UNAVAILABLE');
    const id=++this.sequence,payload=Buffer.from(JSON.stringify({jsonrpc:'2.0',id,method,params})),limit=this.options.maxFrameBytes??2*1024*1024;
    if(payload.length>limit)throw safeError('PROVIDER_SCHEMA_UNSUPPORTED');const frame=Buffer.alloc(4+payload.length);frame.writeUInt32LE(payload.length);payload.copy(frame,4);
    return new Promise((resolve,reject)=>{this.pending={id,resolve,reject};
      // An attempted tools/call write is never automatically retried, including a synchronous transport error.
      if(method==='tools/call')this.written=true;
      try{this.socket!.write(frame,error=>{if(error)this.fail('PROVIDER_UNAVAILABLE');});}catch{this.fail('PROVIDER_UNAVAILABLE');}
    });
  }
  async guard(finalGuard:()=>Promise<void>){
    this.writable();await new Promise<void>((resolve,reject)=>{
      let done=false;const finish=(ok:boolean,error?:unknown)=>{if(done)return;done=true;clearInterval(monitor);ok?resolve():reject(error??safeError('AUTH_REVOKED'));};
      const monitor=setInterval(()=>{if(this.error||this.stopped)finish(false,this.error??safeError('APP_STOPPING'));},5);
      void Promise.resolve().then(finalGuard).then(()=>finish(true),error=>finish(false,error));
    });this.writable();
  }
  close():Promise<void>{
    if(this.closing)return this.closing;this.stopped=true;clearTimeout(this.timer);this.fail('APP_STOPPING');this.buffer=Buffer.alloc(0);
    const socket=this.socket;if(!socket||this.closed)return Promise.resolve();
    this.closing=new Promise<void>((resolve,reject)=>{
      const done=()=>{clearTimeout(timer);socket.removeListener('close',done);resolve();},timer=setTimeout(()=>{socket.removeListener('close',done);reject(safeError('PROVIDER_UNAVAILABLE'));},1000);
      socket.once('close',done);socket.destroy();
    });return this.closing;
  }
}

export class CodexMessageDispatch {
  private options:CodexMessageDispatchOptions;
  private sessions=new Set<DispatchSession>();
  private stopped=false;
  constructor(options:CodexMessageDispatchOptions){
    if(!explicitPipe.test(options.pipe)||!uuid.safeParse(options.callerThreadId).success)throw new AutomationError('PROVIDER_SELECTION_REQUIRED','必须显式指定本机工具管道和调用会话');
    if(options.timeoutMs!==undefined&&(!Number.isInteger(options.timeoutMs)||options.timeoutMs<1||options.timeoutMs>45000)||options.maxFrameBytes!==undefined&&(!Number.isInteger(options.maxFrameBytes)||options.maxFrameBytes<1024||options.maxFrameBytes>8*1024*1024))throw new AutomationError('INVALID_ARGUMENT','投递连接边界参数无效');
    this.options={...options};
  }
  async dispatch(attempt:Attempt,finalGuard:()=>Promise<void>):ReturnType<DeliveryPorts['dispatch']>{
    const captured=z.object({id:uuid,marker:uuid,prompt:z.string().min(1).max(10000),threadRef:z.object({connectionId:uuid,threadId:uuid})}).safeParse(attempt);
    if(!captured.success||this.stopped)return {outcome:'not_written',turnId:null};
    const value=captured.data,prompt=value.prompt+'\n\n[Codex Dog intent '+value.marker+']';
    const session=new DispatchSession(this.options);this.sessions.add(session);
    try{
      await session.open();const raw=await session.request('tools/list',{threadStartKind:'all'}),list=z.object({tools:z.array(z.unknown()).max(2000)}).safeParse(raw);
      if(!list.success)throw safeError('PROVIDER_SCHEMA_UNSUPPORTED');
      const matching=list.data.tools.filter(tool=>!!tool&&typeof tool==='object'&&'name'in tool&&tool.name===fixedTool);
      if(matching.length!==1)throw safeError('PROVIDER_SCHEMA_UNSUPPORTED');const tool=toolSchema.safeParse(matching[0]);if(!tool.success)throw safeError('PROVIDER_SCHEMA_UNSUPPORTED');
      // The operation accepts no caller-selected tool, namespace, host, model or reasoning override.
      const args={threadId:value.threadRef.threadId,hostId:'local',prompt};
      for(const [name,text] of Object.entries(args)){const schema=tool.data.inputSchema.properties[name] as Record<string,unknown>;if(schema.maxLength!==undefined&&(typeof schema.maxLength!=='number'||text.length>schema.maxLength)||schema.minLength!==undefined&&(typeof schema.minLength!=='number'||text.length<schema.minLength)||schema.pattern!==undefined||schema.enum!==undefined)throw safeError('PROVIDER_SCHEMA_UNSUPPORTED');}
      await session.guard(finalGuard);if(this.stopped)throw safeError('APP_STOPPING');
      const response=await session.request('tools/call',{namespace:fixedNamespace,tool:fixedTool,arguments:args,callerSource:'codex',threadId:this.options.callerThreadId,hostId:'local',turnId:'dog-send-'+value.id,callId:'dog-send-'+value.id});
      const result=toolResult.safeParse(response);if(!result.success)throw safeError('PROVIDER_SCHEMA_UNSUPPORTED');
      let accepted:unknown;try{accepted=JSON.parse(result.data.contentItems[0]!.text);}catch{throw safeError('PROVIDER_SCHEMA_UNSUPPORTED');}
      if(!z.object({threadId:z.literal(value.threadRef.threadId)}).strict().safeParse(accepted).success)throw safeError('PROVIDER_SCHEMA_UNSUPPORTED');
      // The actual handler returns only threadId. It supplies no proof of the destination turn.
      return {outcome:'submitted',turnId:null};
    }catch{return {outcome:session.written?'uncertain':'not_written',turnId:null};}
    finally{try{await session.close();this.sessions.delete(session);}catch{/* Retain ownership for explicit close reporting. */}}
  }
  async receipt(_attempt:Attempt):ReturnType<DeliveryPorts['receipt']>{throw new AutomationError('RECEIPT_PROOF_UNAVAILABLE','当前投递协议没有无正文的唯一回执证明，保留原意图并阻断重发');}
  async close(){this.stopped=true;const sessions=[...this.sessions],results=await Promise.allSettled(sessions.map(session=>session.close()));for(let i=0;i<results.length;i++)if(results[i]!.status==='fulfilled')this.sessions.delete(sessions[i]!);if(results.some(result=>result.status==='rejected'))throw safeError('PROVIDER_UNAVAILABLE');}
}
