import test from 'node:test';
import assert from 'node:assert/strict';
import {connect,createServer} from 'node:net';
import type {Socket} from 'node:net';
import {randomUUID} from 'node:crypto';
import {CodexMessageDispatch} from '../packages/infrastructure/codex-message-dispatch.ts';
import type {Attempt} from '../packages/modules/automation/ports.ts';

interface Message {id:number;method:string;params:Record<string,any>}
const makeAttempt=():Attempt=>({id:randomUUID(),source:'live',taskId:null,threadRef:{connectionId:randomUUID(),threadId:randomUUID()},marker:randomUUID(),prompt:'隔离模拟提示词',taskRevision:null,binding:{connectionRevision:1,accountBinding:'fixture-only',goalId:null,latestTurnId:null},owner:{kind:'desktop',clientId:'desktop',revision:1},lease:null,state:'dispatching',slot:'held',submitted:false,receiptMatched:false,turnId:null,reason:'dispatch_boundary',createdAt:new Date().toISOString()});
function tool(){return {name:'send_message_to_thread',namespace:'codex_app',inputSchema:{type:'object',additionalProperties:false,properties:{threadId:{type:'string'},hostId:{type:'string'},prompt:{type:'string'},model:{type:'string'},thinking:{type:'string'}},required:['threadId','prompt']}};}
function frame(value:unknown){const data=Buffer.from(JSON.stringify(value)),header=Buffer.alloc(4);header.writeUInt32LE(data.length);return Buffer.concat([header,data]);}
async function fixture(handler?:(message:Message,socket:Socket)=>void,toolList:unknown={tools:[tool()]}){
  const pipe='\\\\.\\pipe\\codex-app-tools-fixture-dispatch-'+randomUUID(),messages:Message[]=[],sockets=new Set<Socket>();let calls=0;
  const server=createServer(socket=>{sockets.add(socket);let buffer=Buffer.alloc(0);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));socket.on('data',data=>{buffer=Buffer.concat([buffer,data]);while(buffer.length>=4){const size=buffer.readUInt32LE(0);if(buffer.length<size+4)return;const message=JSON.parse(buffer.subarray(4,size+4).toString()) as Message;buffer=buffer.subarray(size+4);messages.push(message);if(message.method==='tools/list'){socket.write(frame({id:message.id,result:toolList}));continue;}calls++;if(handler)handler(message,socket);else socket.write(frame({id:message.id,result:{success:true,contentItems:[{type:'inputText',text:JSON.stringify({threadId:message.params.arguments.threadId})}]}}));}});});
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(pipe,()=>resolve());});
  return {pipe,messages,calls:()=>calls,sockets,close:async()=>{for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
test('构造无IO且仅显式来源，固定目录探测和写前guard，不提供任意tool透传',async()=>{
  const fake=await fixture(),attempt=makeAttempt(),caller=randomUUID();let connections=0,guarded=false;
  const adapter=new CodexMessageDispatch({pipe:fake.pipe,callerThreadId:caller,socketFactory:pipe=>{connections++;assert.equal(pipe,fake.pipe);return connect(pipe);}});
  try{assert.equal(connections,0);assert.deepEqual(await adapter.dispatch(attempt,async()=>{assert.equal(fake.calls(),0);guarded=true;}),{outcome:'submitted',turnId:null});assert(guarded);assert.equal(connections,1);assert.equal(fake.calls(),1);assert.deepEqual(fake.messages.map(message=>message.method),['tools/list','tools/call']);const params=fake.messages[1]!.params;assert.equal(params.namespace,'codex_app');assert.equal(params.tool,'send_message_to_thread');assert.equal(params.threadId,caller);assert.equal(params.arguments.threadId,attempt.threadRef.threadId);assert.equal(params.arguments.hostId,'local');assert(params.arguments.prompt.includes(attempt.marker));assert(params.arguments.prompt.startsWith(attempt.prompt));assert.equal(params.callId,'dog-send-'+attempt.id);assert(!('model'in params.arguments));assert(!('thinking'in params.arguments));
    await assert.rejects(adapter.receipt(attempt),{code:'RECEIPT_PROOF_UNAVAILABLE'});assert.equal(fake.calls(),1);
  }finally{await adapter.close();await fake.close();}
  assert.throws(()=>new CodexMessageDispatch({pipe:'\\\\remote\\pipe\\codex-app-tools-target',callerThreadId:caller}),{code:'PROVIDER_SELECTION_REQUIRED'});assert.throws(()=>new CodexMessageDispatch({pipe:fake.pipe,callerThreadId:''}),{code:'PROVIDER_SELECTION_REQUIRED'});
});
test('缺工具、重复工具、namespace或Schema变化均在发送前阻断',async()=>{
  const wrongNamespace={...tool(),namespace:'other'},wrongRequired={...tool(),inputSchema:{...tool().inputSchema,required:['threadId','prompt','model']}},wrongType={...tool(),inputSchema:{...tool().inputSchema,properties:{...tool().inputSchema.properties,prompt:{type:'number'}}}};
  for(const tools of [[],[tool(),tool()],[wrongNamespace],[wrongRequired],[wrongType]]){const fake=await fixture(undefined,{tools}),adapter=new CodexMessageDispatch({pipe:fake.pipe,callerThreadId:randomUUID(),timeoutMs:100});let guard=0;try{assert.equal((await adapter.dispatch(makeAttempt(),async()=>{guard++;})).outcome,'not_written');assert.equal(fake.calls(),0);assert.equal(guard,0);}finally{await adapter.close();await fake.close();}}
});
test('暂停/撤销或guard超时确定未写入，后续guard恢复不能继续发送',async()=>{
  const fake=await fixture(),adapter=new CodexMessageDispatch({pipe:fake.pipe,callerThreadId:randomUUID(),timeoutMs:40});try{
    assert.equal((await adapter.dispatch(makeAttempt(),async()=>{throw new Error('revoked-private');})).outcome,'not_written');assert.equal(fake.calls(),0);
    assert.equal((await adapter.dispatch(makeAttempt(),()=>Promise.reject())).outcome,'not_written');assert.equal(fake.calls(),0);
    let release!:()=>void;const waiting=adapter.dispatch(makeAttempt(),()=>new Promise(resolve=>{release=resolve;}));assert.equal((await waiting).outcome,'not_written');release();await new Promise(resolve=>setTimeout(resolve,15));assert.equal(fake.calls(),0);
  }finally{await adapter.close();await fake.close();}
});
test('异步核验期间输入对象变化不能替换原目标、prompt或marker',async()=>{
  const fake=await fixture(),adapter=new CodexMessageDispatch({pipe:fake.pipe,callerThreadId:randomUUID()}),attempt=makeAttempt(),original={id:attempt.id,target:attempt.threadRef.threadId,prompt:attempt.prompt,marker:attempt.marker};try{
    assert.equal((await adapter.dispatch(attempt,async()=>{attempt.threadRef.threadId=randomUUID();attempt.marker=randomUUID();attempt.prompt='另一个正文';attempt.id=randomUUID();})).outcome,'submitted');const message=fake.messages[1]!;assert.equal(message.params.arguments.threadId,original.target);assert(message.params.arguments.prompt.startsWith(original.prompt));assert(message.params.arguments.prompt.includes(original.marker));assert.equal(message.params.callId,'dog-send-'+original.id);
  }finally{await adapter.close();await fake.close();}
});
test('写入后断连、超时、工具错误、无效结果和超限响应全部未决且不重发',async()=>{
  for(const mode of ['disconnect','timeout','rpc-error','tool-error','wrong-target','invalid-json','oversize','fake-receipt']){
    const fake=await fixture((message,socket)=>{if(mode==='disconnect')socket.destroy();else if(mode==='rpc-error')socket.write(frame({id:message.id,error:{message:'private-provider-error'}}));else if(mode==='tool-error')socket.write(frame({id:message.id,result:{success:false,contentItems:[{type:'inputText',text:'private-error'}]}}));else if(mode==='wrong-target')socket.write(frame({id:message.id,result:{success:true,contentItems:[{type:'inputText',text:JSON.stringify({threadId:randomUUID()})}]}}));else if(mode==='invalid-json'){const bad=Buffer.from('{broken');const header=Buffer.alloc(4);header.writeUInt32LE(bad.length);socket.write(Buffer.concat([header,bad]));}else if(mode==='oversize'){const header=Buffer.alloc(4);header.writeUInt32LE(2049);socket.write(header);}else if(mode==='fake-receipt')socket.write(frame({id:message.id,result:{success:true,contentItems:[{type:'inputText',text:JSON.stringify({threadId:message.params.arguments.threadId,turnId:'unverified-turn'})}]}}));});
    const adapter=new CodexMessageDispatch({pipe:fake.pipe,callerThreadId:randomUUID(),timeoutMs:100,maxFrameBytes:2048});try{assert.deepEqual(await adapter.dispatch(makeAttempt(),async()=>{}),{outcome:'uncertain',turnId:null},mode);assert.equal(fake.calls(),1,mode);}finally{await adapter.close();await fake.close();}
  }
});
test('明确关闭只清本适配器socket；在途发送保留未决，离线不重连',async()=>{
  const fake=await fixture(()=>{}),adapter=new CodexMessageDispatch({pipe:fake.pipe,callerThreadId:randomUUID(),timeoutMs:1000});let sent!:()=>void;const observed=new Promise<void>(resolve=>{sent=resolve;});
  try{const pending=adapter.dispatch(makeAttempt(),async()=>{setTimeout(sent,5);});await observed;assert.equal(fake.calls(),1);await adapter.close();assert.equal((await pending).outcome,'uncertain');assert.equal((await adapter.dispatch(makeAttempt(),async()=>{})).outcome,'not_written');assert.equal(fake.calls(),1);await new Promise(resolve=>setTimeout(resolve,5));assert.equal(fake.sockets.size,0);}finally{await adapter.close();await fake.close();}
});
test('无法连接与构造参数错误不能尝试发送；receipt查询不打开任何连接',async()=>{
  let connections=0;const adapter=new CodexMessageDispatch({pipe:'\\\\.\\pipe\\codex-app-tools-fixture-absent-'+randomUUID(),callerThreadId:randomUUID(),timeoutMs:40,socketFactory:()=>{connections++;throw new Error('private-connect-error');}});
  try{await assert.rejects(adapter.receipt(makeAttempt()),{code:'RECEIPT_PROOF_UNAVAILABLE'});assert.equal(connections,0);assert.equal((await adapter.dispatch(makeAttempt(),async()=>{})).outcome,'not_written');assert.equal(connections,1);}finally{await adapter.close();}
});
