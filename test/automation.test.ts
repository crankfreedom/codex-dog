import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { SqliteStore } from '../packages/infrastructure/sqlite-store.ts';
import { TemplateService } from '../packages/modules/templates/service.ts';
import { TaskService } from '../packages/modules/tasks/service.ts';
import { AutomationError } from '../packages/modules/automation/ports.ts';
import type { AutomationPorts } from '../packages/modules/automation/ports.ts';
import { automationDefinitions } from '../packages/contracts/automation.ts';
import {DatabaseSync} from 'node:sqlite';
import {definitions,describe} from '../packages/contracts/protocol.ts';
const actor={kind:'external' as const,clientId:randomUUID(),revision:1};
function setup(fault?:(stage:string)=>void){const dir=mkdtempSync(join(tmpdir(),'dog-automation-'));const store=new SqliteStore(join(dir,'data.sqlite'),fault);store.start();const granted=new Set(['read','tasks.manage']);const ports:AutomationPorts={now:()=>Date.parse('2026-11-17T00:00:00Z'),newId:randomUUID,digest:x=>createHash('sha256').update(x).digest('hex'),authorize:async(_actor,scope)=>{if(!granted.has(scope))throw new AutomationError('PERMISSION_DENIED','缺少授权');},observe:async()=>({binding:{connectionRevision:1,accountBinding:'fixture',goalId:null,latestTurnId:'turn'},known:true,idle:true,approval:false,goalKnown:true,completionConfirmed:false,source:'fixture',reason:'fixture'})};return {dir,store,granted,ports,templates:new TemplateService(store,ports),tasks:new TaskService(store,ports),close:()=>{store.close();rmSync(dir,{recursive:true,force:true});}};}
function params(name:string,p:unknown){return automationDefinitions.find(x=>x.operation===name)!.input.parse(p) as Record<string,unknown>;}
test('模板快照、默认项变化、任务暂停编辑和内容权限闭环',async()=>{const f=setup();try{
  const template=await f.templates.invoke('templates.create',params('templates.create',{name:'原模板',body:'初始正文'}),actor,'template');
  const task=await f.tasks.invoke('tasks.create',params('tasks.create',{threadRef:{connectionId:randomUUID(),threadId:randomUUID()},templateRef:{templateId:template.id,revision:1}}),actor,'task');
  assert.equal(task.prompt,null);assert.equal(task.enabled,false);assert.equal(task.mode,'observe');
  await f.templates.invoke('templates.update',{id:template.id,expectedRevision:1,patch:{body:'新正文'}},actor,'edit-template');
  await assert.rejects(f.tasks.invoke('tasks.get',{id:task.id,includeContent:true},actor),{code:'PERMISSION_DENIED'});
  f.granted.add('content.read');assert.equal((await f.tasks.invoke('tasks.get',{id:task.id,includeContent:true},actor)).prompt,'初始正文');
  await f.tasks.invoke('tasks.enable',{id:task.id,confirmedRevision:1},actor,'enable');
  await assert.rejects(f.tasks.invoke('tasks.update',{id:task.id,expectedRevision:1,patch:{prompt:'编辑'}},actor,'edit-enabled'),{code:'TASK_MUST_PAUSE'});
  await f.tasks.invoke('tasks.pause',{id:task.id},actor,'pause');
  const edited=await f.tasks.invoke('tasks.update',{id:task.id,expectedRevision:1,patch:{prompt:'编辑'}},actor,'edit');assert.equal(edited.enabled,false);assert.equal(edited.revision,2);assert.equal(edited.resumeCount,0);
  await assert.rejects(f.tasks.invoke('tasks.enable',{id:task.id,confirmedRevision:1},actor,'enable-old'),{code:'REVISION_CONFLICT'});
  await f.tasks.invoke('tasks.remove',{id:task.id,expectedRevision:2},actor,'remove');assert.equal((await f.tasks.invoke('archives.get',{id:task.id},actor)).archived,true);
  assert.equal((await f.tasks.invoke('timelines.get',{id:task.id,after:0,limit:50},actor)).items instanceof Array,true);
}finally{f.close();}});
test('持久幂等、同键冲突、重复目标与授权撤销失败关闭',async()=>{const f=setup();try{
  const input=params('tasks.create',{threadRef:{connectionId:randomUUID(),threadId:randomUUID()},prompt:'正文'});const first=await f.tasks.invoke('tasks.create',input,actor,'same');f.store.close();f.store.start();
  assert.deepEqual(await f.tasks.invoke('tasks.create',input,actor,'same'),first);
  await assert.rejects(f.tasks.invoke('tasks.create',{...input,prompt:'别的正文'},actor,'same'),{code:'IDEMPOTENCY_CONFLICT'});
  await assert.rejects(f.tasks.invoke('tasks.create',input,actor,'new-key'),{code:'TARGET_MANAGED'});
  f.granted.delete('tasks.manage');await assert.rejects(f.tasks.invoke('tasks.pause',{id:first.id},actor,'revoked'),{code:'PERMISSION_DENIED'});
}finally{f.close();}});
test('业务提交故障将任务、幂等、事件整体回滚',async()=>{let fail=true;const f=setup(stage=>{if(fail&&stage==='automation:commit')throw new Error('fault');});try{
  const input=params('tasks.create',{threadRef:{connectionId:randomUUID(),threadId:randomUUID()},prompt:'正文'});
  await assert.rejects(f.tasks.invoke('tasks.create',input,actor,'retry'));assert.equal(f.store.readAutomation().tasks.length,0);assert.equal(f.store.readAutomation().operations.length,0);assert.equal(f.store.readAutomation().events.length,0);
  fail=false;await f.tasks.invoke('tasks.create',input,actor,'retry');assert.equal(f.store.readAutomation().tasks.length,1);
}finally{f.close();}});
test('自动授权绑定精确修订、轮次与 Goal；仅观察无需副作用授权',async()=>{const f=setup();try{
  const task=await f.tasks.invoke('tasks.create',params('tasks.create',{threadRef:{connectionId:randomUUID(),threadId:randomUUID()},prompt:'正文',mode:'auto'}),actor,'create');
  const enable={id:task.id,confirmedRevision:1,authorization:{allowAutomaticSend:true,connectionRevision:1,expectedGoalId:null,expectedLatestTurnId:'turn'}};
  await assert.rejects(f.tasks.invoke('tasks.enable',enable,actor,'enable'),{code:'PERMISSION_DENIED'});f.granted.add('messages.send');
  await assert.rejects(f.tasks.invoke('tasks.enable',{...enable,authorization:{...enable.authorization,expectedLatestTurnId:'old'}},actor,'wrong'),{code:'REVISION_CONFLICT'});
  assert.equal((await f.tasks.invoke('tasks.enable',enable,actor,'enable')).enabled,true);
}finally{f.close();}});
test('旧业务来源无证据时迁移为 unknown，不以当前来源改写历史；显式重绑保留次数',async()=>{const f=setup();try{
 const task=await f.tasks.invoke('tasks.create',params('tasks.create',{threadRef:{connectionId:randomUUID(),threadId:randomUUID()},prompt:'模拟'}),actor,'old');f.store.close();const old=new DatabaseSync(join(f.dir,'data.sqlite'));const state=JSON.parse(String(old.prepare('SELECT payload FROM automation_state').get()!.payload));for(const task of state.tasks)delete task.source;for(const operation of state.operations)delete operation.result.source;old.prepare('UPDATE automation_state SET payload=?').run(JSON.stringify(state));old.exec('PRAGMA user_version=10');old.close();f.store.start();assert.equal(f.store.readAutomation().tasks[0]!.source,'unknown');const rebound=await f.tasks.invoke('tasks.enable',{id:task.id,confirmedRevision:1,connectionId:randomUUID()},actor,'explicit-rebind');assert.equal(rebound.source,'fixture');assert.equal(rebound.resumeCount,0);
}finally{f.close();}});
test('新增能力均有输出Schema、条件权限和唯一三入口映射',()=>{
 const names=new Set<string>(),tools=new Set<string>(),commands=new Set<string>();for(const definition of definitions){assert(!names.has(definition.operation));assert(!tools.has(definition.tool));assert(!commands.has(definition.command.join(' ')));names.add(definition.operation);tools.add(definition.tool);commands.add(definition.command.join(' '));if(/^(tasks|templates|attempts|archives|timelines|queue|scheduler|reset|notifications)\b/.test(definition.operation)||definition.operation==='threads.send')assert(describe(definition.operation)!.outputSchema);}
 assert.deepEqual(describe('resetAppointments.create')!.scopes,['cards.manage','cards.consume']);assert(describe('tasks.get')!.conditionalScopes.some(x=>x.scopes.includes('content.read')));
});
