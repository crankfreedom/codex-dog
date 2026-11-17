import {spawn} from 'node:child_process';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {createHash} from 'node:crypto';
import {isAbsolute,win32} from 'node:path';
import {z} from 'zod';
import {version} from '../contracts/protocol.ts';
import {AutomationError} from '../modules/automation/ports.ts';
import type {Appointment,CardObservation,CardProviderPort} from '../modules/cards/ports.ts';

export type CardProcess = Pick<ChildProcessWithoutNullStreams,'stdin'|'stdout'|'stderr'|'on'|'once'|'removeListener'|'kill'|'killed'|'exitCode'|'pid'>;
export interface AppServerCardsOptions {
  executable:string;
  timeoutMs?:number;
  maxFrameBytes?:number;
  now?:()=>number;
  processFactory?:(executable:string,args:readonly string[])=>CardProcess;
}
const opaque=z.string().min(1).max(512).refine(value=>value.trim().length>0);
const outcomeSchema=z.object({outcome:z.enum(['reset','nothingToReset','noCredit','alreadyRedeemed'])}).strict();
const initializedSchema=z.object({codexHome:z.string().min(1).max(32768).refine(value=>isAbsolute(value)||win32.isAbsolute(value)),platformFamily:z.string().min(1).max(100),platformOs:z.string().min(1).max(100),userAgent:z.string().min(1).max(2000)});
const cardSchema=z.object({
  id:opaque,title:z.string().max(500).nullable().optional(),description:z.string().max(4000).nullable().optional(),
  status:z.enum(['available','redeeming','redeemed','unknown']),resetType:z.enum(['codexRateLimits','unknown']),
  grantedAt:z.number().int().nonnegative(),expiresAt:z.number().int().nonnegative().nullable().optional(),
}).strict();
// Only the needed documented projection is retained. Details missing/null are not an empty card list.
const cardsResponseSchema=z.object({accountId:opaque,rateLimitResetCredits:z.object({availableCount:z.number().int().nonnegative(),credits:z.array(cardSchema).max(200)}).strict()});
const fixedError=(code:string)=>new AutomationError(code,code==='APP_STOPPING'?'卡片来源正在关闭':'卡片来源不可用或协议不兼容');

class CardSession {
  private child?:CardProcess;
  private timeoutMs:number;
  private limit:number;
  private factory:AppServerCardsOptions['processFactory'];
  private executable:string;
  private timer?:NodeJS.Timeout;
  private failure?:AutomationError;
  private stopped=false;
  private exited=false;
  private buffer=Buffer.alloc(0);
  private received=0;
  private sequence=0;
  private pending?:{id:number;resolve(value:unknown):void;reject(error:Error):void};
  private startup?:{resolve():void;reject(error:Error):void};
  private closing?:Promise<void>;
  consumeWritten=false;
  constructor(options:AppServerCardsOptions){this.executable=options.executable;this.timeoutMs=options.timeoutMs??15000;this.limit=options.maxFrameBytes??1024*1024;this.factory=options.processFactory;}
  async start(){
    try{this.child=this.factory?this.factory(this.executable,['app-server','--listen','stdio://']):spawn(this.executable,['app-server','--listen','stdio://'],{stdio:'pipe',windowsHide:true});}
    catch{throw fixedError('PROVIDER_UNAVAILABLE');}
    const child=this.child;
    child.stderr.resume(); // Never retain or log raw stderr, which may include account/credential details.
    child.stdout.on('data',(data:Buffer|string)=>this.receive(Buffer.isBuffer(data)?data:Buffer.from(data)));
    child.on('error',()=>this.fail('PROVIDER_UNAVAILABLE'));
    child.once('exit',()=>{this.exited=true;this.fail('PROVIDER_UNAVAILABLE');});
    child.once('close',()=>{this.exited=true;this.fail('PROVIDER_UNAVAILABLE');});
    this.timer=setTimeout(()=>{this.fail('READ_TIMEOUT');try{child.kill();}catch{}},this.timeoutMs);
    await new Promise<void>((resolve,reject)=>{this.startup={resolve,reject};child.once('spawn',()=>{this.startup=undefined;resolve();});if(this.failure){this.startup=undefined;reject(this.failure);}});
  }
  private fail(code:string){
    this.failure??=fixedError(code);const startup=this.startup,pending=this.pending;this.startup=undefined;this.pending=undefined;
    startup?.reject(this.failure);pending?.reject(this.failure);
  }
  private receive(data:Buffer){
    if(this.stopped||this.failure)return;
    this.received+=data.length;
    if(this.received>this.limit*4){this.fail('PROVIDER_SCHEMA_UNSUPPORTED');return;}
    this.buffer=Buffer.concat([this.buffer,data]);
    while(this.buffer.length){
      const newline=this.buffer.indexOf(10);
      if(newline<0){if(this.buffer.length>this.limit)this.fail('PROVIDER_SCHEMA_UNSUPPORTED');return;}
      if(newline>this.limit){this.fail('PROVIDER_SCHEMA_UNSUPPORTED');return;}
      const line=this.buffer.subarray(0,newline);this.buffer=this.buffer.subarray(newline+1);if(!line.length)continue;
      let message:unknown;try{message=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(line));}catch{this.fail('PROVIDER_SCHEMA_UNSUPPORTED');return;}
      if(!message||typeof message!=='object'||Array.isArray(message)){this.fail('PROVIDER_SCHEMA_UNSUPPORTED');return;}
      const raw=message as Record<string,unknown>;
      if(!this.pending||raw.id!==this.pending.id)continue;
      if(raw.error!==undefined||!Object.hasOwn(raw,'result')){this.fail('PROVIDER_UNAVAILABLE');return;}
      const pending=this.pending;this.pending=undefined;pending?.resolve(raw.result);
    }
  }
  private assertWritable(){if(this.stopped||this.failure)throw this.failure??fixedError('APP_STOPPING');if(!this.child||this.child.killed||this.child.stdin.destroyed||!this.child.stdin.writable)throw fixedError('PROVIDER_UNAVAILABLE');}
  notifyInitialized(){
    this.assertWritable();this.child!.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n',error=>{if(error)this.fail('PROVIDER_UNAVAILABLE');});
  }
  request(method:'initialize'|'account/rateLimits/read'|'account/rateLimitResetCredit/consume',params:Record<string,unknown>):Promise<unknown>{
    this.assertWritable();if(this.pending)throw fixedError('PROVIDER_UNAVAILABLE');
    const id=++this.sequence,payload=Buffer.from(JSON.stringify({id,method,params})+'\n');
    if(payload.length>this.limit)throw fixedError('PROVIDER_SCHEMA_UNSUPPORTED');
    return new Promise((resolve,reject)=>{
      this.pending={id,resolve,reject};
      // From the first write attempt onward a transport failure is never proof of non-delivery.
      if(method==='account/rateLimitResetCredit/consume')this.consumeWritten=true;
      try{this.child!.stdin.write(payload,error=>{if(error)this.fail('PROVIDER_UNAVAILABLE');});}catch{this.fail('PROVIDER_UNAVAILABLE');}
    });
  }
  async guard(check:()=>Promise<void>){
    this.assertWritable();
    // The session deadline also bounds a stalled finalGuard. A later resolution cannot write.
    await new Promise<void>((resolve,reject)=>{
      let settled=false;const finish=(ok:boolean,error?:unknown)=>{if(settled)return;settled=true;clearInterval(monitor);ok?resolve():reject(error??fixedError('AUTH_REVOKED'));};
      const monitor=setInterval(()=>{if(this.failure||this.stopped)finish(false,this.failure??fixedError('APP_STOPPING'));},5);
      void Promise.resolve().then(check).then(()=>finish(true),error=>finish(false,error));
    });this.assertWritable();
  }
  close():Promise<void>{
    if(this.closing)return this.closing;
    this.stopped=true;clearTimeout(this.timer);this.fail('APP_STOPPING');this.buffer=Buffer.alloc(0);
    const child=this.child;if(!child||this.exited||child.exitCode!==null)return Promise.resolve();
    this.closing=new Promise<void>((resolve,reject)=>{
      const done=()=>{clearTimeout(timer);child.removeListener('exit',done);child.removeListener('close',done);resolve();};
      const timer=setTimeout(()=>{child.removeListener('exit',done);child.removeListener('close',done);reject(fixedError('PROVIDER_UNAVAILABLE'));},1000);
      child.once('exit',done);child.once('close',done);
      try{child.stdin.end();child.kill();}catch{clearTimeout(timer);child.removeListener('exit',done);child.removeListener('close',done);reject(fixedError('PROVIDER_UNAVAILABLE'));}
    });return this.closing;
  }
}

export class AppServerCards implements CardProviderPort {
  private options:AppServerCardsOptions;
  private sessions=new Set<CardSession>();
  private stopped=false;
  private binding?:string;
  private identityChanged=false;
  constructor(options:AppServerCardsOptions){
    if(!options.executable||!(isAbsolute(options.executable)||win32.isAbsolute(options.executable))||options.executable.startsWith('\\\\')||!/(?:^|[\\/])codex\.exe$/i.test(options.executable))throw new AutomationError('INVALID_ARGUMENT','必须显式指定本机 Codex CLI 绝对路径');
    if(options.timeoutMs!==undefined&&(!Number.isInteger(options.timeoutMs)||options.timeoutMs<1||options.timeoutMs>45000)||options.maxFrameBytes!==undefined&&(!Number.isInteger(options.maxFrameBytes)||options.maxFrameBytes<1024||options.maxFrameBytes>8*1024*1024))throw new AutomationError('INVALID_ARGUMENT','卡片来源边界参数无效');
    this.options={...options};
  }
  private async initialize(session:CardSession){
    await session.start();const raw=await session.request('initialize',{clientInfo:{name:'codex_dog',title:'Codex Dog',version},capabilities:{experimentalApi:true,explicitGatewayOauth:true}});
    if(!initializedSchema.safeParse(raw).success)throw fixedError('PROVIDER_SCHEMA_UNSUPPORTED');session.notifyInitialized();
  }
  private async using<T>(work:(session:CardSession)=>Promise<T>){
    if(this.stopped)throw fixedError('APP_STOPPING');
    const session=new CardSession(this.options);this.sessions.add(session);
    try{await this.initialize(session);return await work(session);}
    finally{try{await session.close();this.sessions.delete(session);}catch{/* Keep ownership so explicit close can report incomplete cleanup. */}}
  }
  async read():Promise<CardObservation>{
    if(this.identityChanged)throw fixedError('CONNECTION_IDENTITY_CHANGED');
    return this.using(async session=>{
      const raw=await session.request('account/rateLimits/read',{excludeResetCreditDetails:false}),parsed=cardsResponseSchema.safeParse(raw);
      if(this.identityChanged)throw fixedError('CONNECTION_IDENTITY_CHANGED');
      if(!parsed.success)throw fixedError('PROVIDER_SCHEMA_UNSUPPORTED');
      const binding=createHash('sha256').update(parsed.data.accountId).digest('hex');
      if(this.binding&&this.binding!==binding){this.identityChanged=true;throw fixedError('CONNECTION_IDENTITY_CHANGED');}
      this.binding=binding;const cards=parsed.data.rateLimitResetCredits.credits;
      if(new Set(cards.map(card=>card.id)).size!==cards.length)throw fixedError('PROVIDER_SCHEMA_UNSUPPORTED');
      return {accountBinding:binding,source:'live',verified:true,observedAt:new Date((this.options.now??Date.now)()).toISOString(),cards:cards.map(card=>{
        const expiry=card.expiresAt==null?null:card.expiresAt*1000;if(expiry!==null&&!Number.isFinite(new Date(expiry).getTime()))throw fixedError('PROVIDER_SCHEMA_UNSUPPORTED');
        return {id:card.id,title:card.title??'重置卡',status:card.resetType==='codexRateLimits'?card.status:'unknown',expiresAt:expiry===null?null:new Date(expiry).toISOString()};
      })};
    });
  }
  private async redeem(appointment:Appointment,finalGuard:()=>Promise<void>):ReturnType<CardProviderPort['consume']>{
    const credit=opaque.safeParse(appointment.creditId),key=z.string().min(1).max(200).refine(value=>value.trim().length>0).safeParse(appointment.consumeKey);
    const expectedBinding=appointment.accountBinding;
    if(!credit.success||!key.success||this.stopped||this.identityChanged)return {outcome:'not_written'};
    let consumeWritten=false;
    try{return await this.using(async session=>{
      try{await session.guard(finalGuard);if(this.stopped||this.identityChanged||this.binding&&this.binding!==expectedBinding)return {outcome:'not_written' as const};const raw=await session.request('account/rateLimitResetCredit/consume',{creditId:credit.data,idempotencyKey:key.data});consumeWritten=session.consumeWritten;
        const result=outcomeSchema.safeParse(raw);return result.success?result.data:{outcome:'uncertain' as const};
      }catch{consumeWritten=session.consumeWritten;return {outcome:consumeWritten?'uncertain' as const:'not_written' as const};}
    });}catch{return {outcome:consumeWritten?'uncertain':'not_written'};}
  }
  consume(appointment:Appointment,finalGuard:()=>Promise<void>){return this.redeem(appointment,finalGuard);}
  reconcile(appointment:Appointment,finalGuard:()=>Promise<void>){return this.redeem(appointment,finalGuard);}
  async close(){this.stopped=true;const sessions=[...this.sessions];const results=await Promise.allSettled(sessions.map(session=>session.close()));for(let i=0;i<results.length;i++)if(results[i]!.status==='fulfilled')this.sessions.delete(sessions[i]!);if(results.some(result=>result.status==='rejected'))throw fixedError('PROVIDER_UNAVAILABLE');}
}
