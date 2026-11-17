import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createHash,randomUUID} from 'node:crypto';
import {AppServerCards} from '../packages/infrastructure/app-server-cards.ts';
import type {CardProcess} from '../packages/infrastructure/app-server-cards.ts';
import type {Appointment} from '../packages/modules/cards/ports.ts';

type Message={id?:number;method:string;params:Record<string,unknown>};
type Handler=(message:Message,child:FakeChild)=>void;
class FakeChild extends EventEmitter {
  readonly stdout=new PassThrough();readonly stderr=new PassThrough();readonly stdin:Writable;
  readonly messages:Message[]=[];killed=false;exitCode:number|null=null;pid=100000;
  constructor(handler:Handler){super();let buffer='';this.stdin=new Writable({write:(data,_encoding,done)=>{buffer+=data.toString();while(buffer.includes('\n')){const end=buffer.indexOf('\n'),line=buffer.slice(0,end);buffer=buffer.slice(end+1);const message=JSON.parse(line) as Message;this.messages.push(message);queueMicrotask(()=>{if(!this.killed)handler(message,this);});}done();}});queueMicrotask(()=>this.emit('spawn'));}
  reply(id:number|undefined,result:unknown){this.stdout.write(JSON.stringify({id,result})+'\n');}
  kill(){if(this.killed)return false;this.killed=true;this.exitCode=0;this.stdin.destroy();this.emit('exit',0,null);this.stdout.end();this.stderr.end();this.emit('close',0,null);return true;}
}
const initialize={userAgent:'codex-test',codexHome:'C:\\isolated-codex',platformFamily:'windows',platformOs:'windows'};
const detail=()=>({accountId:'private-account',rateLimits:{},rateLimitResetCredits:{availableCount:1,credits:[{id:'opaque-card',title:'指定卡',description:null,status:'available',resetType:'codexRateLimits',grantedAt:100,expiresAt:200}]}});
const appointment=():Appointment=>({id:randomUUID(),source:'live',cardKey:'a'.repeat(64),creditId:'opaque-card',accountBinding:createHash('sha256').update('private-account').digest('hex'),consumeKey:randomUUID(),scheduledAt:new Date().toISOString(),timeZone:'Asia/Shanghai',owner:{kind:'desktop',clientId:'desktop',revision:1},state:'running',revision:1,outcome:null,reason:'claimed',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),calls:1});
function setup(handler:Handler,options:{timeoutMs?:number;maxFrameBytes?:number}={}){
  const children:FakeChild[]=[],spawns:Array<{executable:string;args:readonly string[]}>=[];
  const provider=new AppServerCards({executable:'C:\\explicit\\codex.exe',...options,now:()=>1000,processFactory:(executable,args)=>{spawns.push({executable,args});const child=new FakeChild((message,proc)=>{if(message.method==='initialize')proc.reply(message.id,initialize);else handler(message,proc);});children.push(child);return child as unknown as CardProcess;}});
  return {provider,children,spawns};
}
test('真实卡适配器构造无IO，显式CLI和固定只读方法，账号只保留摘要',async()=>{
  const f=setup((message,child)=>{if(message.method==='account/rateLimits/read'){assert.deepEqual(message.params,{excludeResetCreditDetails:false});child.reply(message.id,detail());}});
  assert.equal(f.spawns.length,0);const snapshot=await f.provider.read();
  assert.deepEqual(f.spawns,[{executable:'C:\\explicit\\codex.exe',args:['app-server','--listen','stdio://']}]);assert.equal(snapshot.source,'live');assert.equal(snapshot.verified,true);assert.equal(snapshot.accountBinding,createHash('sha256').update('private-account').digest('hex'));assert.equal(snapshot.cards[0]!.expiresAt,'1970-01-01T00:03:20.000Z');assert.equal(JSON.stringify(snapshot).includes('private-account'),false);assert(f.children.every(child=>child.killed));
  const methods=f.children[0]!.messages.map(message=>message.method);assert.deepEqual(methods,['initialize','initialized','account/rateLimits/read']);await f.provider.close();
  assert.throws(()=>new AppServerCards({executable:'codex.exe'}),{code:'INVALID_ARGUMENT'});assert.throws(()=>new AppServerCards({executable:'\\\\remote\\codex.exe'}),{code:'INVALID_ARGUMENT'});
});
test('卡来源账号缺失、明细null/缺失、损坏字段和重复ID失败关闭，未知重置类型不当可用',async()=>{
  for(const mutate of [
    (value:any)=>{delete value.accountId;},(value:any)=>{value.accountId=null;},(value:any)=>{value.rateLimitResetCredits.credits=null;},(value:any)=>{delete value.rateLimitResetCredits.credits;},(value:any)=>{value.rateLimitResetCredits.credits[0].expiresAt='later';},(value:any)=>{value.rateLimitResetCredits.credits.push({...value.rateLimitResetCredits.credits[0]});},
  ]){const f=setup((message,child)=>{if(message.method==='account/rateLimits/read'){const value=detail();mutate(value);child.reply(message.id,value);}});await assert.rejects(f.provider.read(),{code:'PROVIDER_SCHEMA_UNSUPPORTED'});assert(f.children.every(child=>child.killed));await f.provider.close();}
  const unknown=setup((message,child)=>{if(message.method==='account/rateLimits/read'){const value=detail();value.rateLimitResetCredits.credits[0]!.resetType='unknown';child.reply(message.id,value);}});assert.equal((await unknown.provider.read()).cards[0]!.status,'unknown');await unknown.provider.close();
});
test('当前卡来源账号变化使连接失效，不继续返回旧账号或自动选择新账号',async()=>{
  let account='first';const f=setup((message,child)=>{if(message.method==='account/rateLimits/read')child.reply(message.id,{...detail(),accountId:account});});await f.provider.read();account='second';await assert.rejects(f.provider.read(),{code:'CONNECTION_IDENTITY_CHANGED'});const spawns=f.spawns.length;await assert.rejects(f.provider.read(),{code:'CONNECTION_IDENTITY_CHANGED'});assert.equal(f.spawns.length,spawns);await f.provider.close();
});
test('消费和核对只用原卡原键，写入前复核，四种结果严格解释',async()=>{
  const original=appointment();let guarded=false,mode='reset';const sent:Message[]=[];const f=setup((message,child)=>{if(message.method==='account/rateLimitResetCredit/consume'){assert(guarded);sent.push(message);child.reply(message.id,{outcome:mode});}});
  assert.equal((await f.provider.consume(original,async()=>{guarded=true;})).outcome,'reset');guarded=false;mode='alreadyRedeemed';assert.equal((await f.provider.reconcile(original,async()=>{guarded=true;})).outcome,'alreadyRedeemed');assert.equal(sent.length,2);for(const message of sent)assert.deepEqual(message.params,{creditId:original.creditId,idempotencyKey:original.consumeKey});
  for(const outcome of ['nothingToReset','noCredit']){mode=outcome;assert.equal((await f.provider.consume(original,async()=>{})).outcome,outcome);}
  const before=f.spawns.length;assert.equal((await f.provider.consume({...original,creditId:''},async()=>{})).outcome,'not_written');assert.equal((await f.provider.consume({...original,consumeKey:''},async()=>{})).outcome,'not_written');assert.equal(f.spawns.length,before);await f.provider.close();
});
test('写入前撤销及超时确定未写入；延迟guard恢复后不能继续消费',async()=>{
  let calls=0;const f=setup((message,child)=>{if(message.method==='account/rateLimitResetCredit/consume'){calls++;child.reply(message.id,{outcome:'reset'});}},{timeoutMs:25});
  assert.equal((await f.provider.consume(appointment(),async()=>{throw new Error('secret-revocation');})).outcome,'not_written');assert.equal(calls,0);
  for(const reason of [undefined,null,false]){assert.equal((await f.provider.consume(appointment(),()=>Promise.reject(reason))).outcome,'not_written');assert.equal(calls,0);}
  let release!:()=>void;const waiting=f.provider.consume(appointment(),()=>new Promise(resolve=>{release=resolve;}));assert.equal((await waiting).outcome,'not_written');release();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(calls,0);assert(f.children.every(child=>child.killed));await f.provider.close();
});
test('异步复核不能偷偷替换当前调用已捕获的原卡或幂等键',async()=>{
  const original=appointment(),creditId=original.creditId,idempotencyKey=original.consumeKey;let actual:unknown;
  const f=setup((message,child)=>{if(message.method==='account/rateLimitResetCredit/consume'){actual=message.params;child.reply(message.id,{outcome:'reset'});}});
  const result=await f.provider.consume(original,async()=>{original.creditId='different-card';original.consumeKey=randomUUID();});assert.equal(result.outcome,'reset');assert.deepEqual(actual,{creditId,idempotencyKey});await f.provider.close();
});
test('消费写入后响应丢失、错误、损坏JSON和超限帧一律未决，不自动补发',async()=>{
  for(const failure of ['disconnect','error','bad-json','oversize','missing-outcome','timeout']){
    let calls=0;const f=setup((message,child)=>{if(message.method==='account/rateLimitResetCredit/consume'){calls++;if(failure==='disconnect')child.kill();if(failure==='error')child.stdout.write(JSON.stringify({id:message.id,error:{message:'private-account secret-token'}})+'\n');if(failure==='bad-json')child.stdout.write('{broken\n');if(failure==='oversize')child.stdout.write('x'.repeat(1100));if(failure==='missing-outcome')child.reply(message.id,{unexpected:'private-payload'});}},{timeoutMs:30,maxFrameBytes:1024});
    assert.equal((await f.provider.consume(appointment(),async()=>{})).outcome,'uncertain',failure);assert.equal(calls,1);assert(f.children.every(child=>child.killed));await f.provider.close();
  }
});
test('只读输出错误有界且脱敏，通知无id不误当响应，close清理本实例在途进程',async()=>{
  const f=setup((message,child)=>{if(message.method==='account/rateLimits/read'){child.stderr.write('private-account private-token');child.stdout.write(JSON.stringify({method:'account/updated',params:{}})+'\n');child.reply(message.id,detail());}});assert.equal((await f.provider.read()).cards.length,1);await f.provider.close();await assert.rejects(f.provider.read(),{code:'APP_STOPPING'});
  const blocked=setup(()=>{},{timeoutMs:1000});const reading=blocked.provider.read();await new Promise(resolve=>setTimeout(resolve,5));await blocked.provider.close();await assert.rejects(reading,error=>error instanceof Error&&!error.message.includes('private')&&'code'in error);assert(blocked.children.every(child=>child.killed));
});
