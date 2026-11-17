import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {SqliteStore} from '../packages/infrastructure/sqlite-store.ts';
import {CardService} from '../packages/modules/cards/service.ts';
import {FixtureCards} from '../packages/infrastructure/fixture-cards.ts';
import {AutomationError} from '../packages/modules/automation/ports.ts';
import type {AutomationPorts} from '../packages/modules/automation/ports.ts';
const actor={kind:'external' as const,clientId:randomUUID(),revision:1};
function setup(){const directory=mkdtempSync(join(tmpdir(),'dog-cards-')),store=new SqliteStore(join(directory,'db.sqlite'));store.start();let now=Date.now(),revoked=false;const ports:AutomationPorts={now:()=>now,newId:randomUUID,digest:x=>createHash('sha256').update(x).digest('hex'),authorize:async()=>{if(revoked)throw new AutomationError('AUTH_REVOKED','revoked');},observe:async()=>{throw new Error('not used');}};const provider=new FixtureCards(store,()=>now),service=new CardService(store,ports,provider,()=>()=>{});service.start();const input=(card='fixture-card-one')=>({cardKey:ports.digest(card),scheduledAt:new Date(now+1000).toISOString(),timeZone:'Asia/Shanghai',confirm:true});return {store,ports,provider,service,input,advance:(ms:number)=>now+=ms,revoke:()=>revoked=true,close:async()=>{await service.close();store.close();rmSync(directory,{recursive:true,force:true});}};}
test('指定卡预约原子领取和持久幂等，并发到期至多消费一次',async()=>{const f=setup();try{
 const input=f.input(),created=await f.service.invoke('resetAppointments.create',input,actor,'create');assert(!('creditId'in created));assert(!('consumeKey'in created));assert.deepEqual(await f.service.invoke('resetAppointments.create',input,actor,'create'),created);
 await assert.rejects(f.service.invoke('resetAppointments.create',input,actor,'other'),{code:'UNRESOLVED_CONSUMPTION'});f.advance(1000);await Promise.all([f.service.tick(),f.service.tick()]);const item=f.store.readAutomation().appointments[0]!;assert.equal(item.state,'succeeded');assert.equal(item.calls,1);assert.equal(item.outcome,'reset');assert.equal(f.store.fixtureCardConsumed('fixture-card-one'),true);
 }finally{await f.close();}});
test('消费响应丢失保留原卡原键，重启和换卡不能绕过；显式核对只完成原消费',async()=>{const f=setup();try{
 const original=f.provider.consume.bind(f.provider);f.provider.consume=async(item,guard)=>{await original(item,guard);return {outcome:'uncertain'};};const appointment=await f.service.invoke('resetAppointments.create',f.input(),actor,'create');f.advance(1000);await f.service.tick();const before=f.store.readAutomation().appointments[0]!;assert.equal(before.state,'uncertain');const key=before.consumeKey;
 await assert.rejects(f.service.invoke('resetAppointments.create',f.input('fixture-card-two'),actor,'switch'),{code:'UNRESOLVED_CONSUMPTION'});await f.service.close();f.store.close();f.store.start();f.service.start();assert.equal(f.store.readAutomation().appointments[0]!.consumeKey,key);
 f.provider.consume=original;const result=await f.service.invoke('resetAppointments.reconcile',{id:appointment.id,confirmMayComplete:true},actor,'reconcile');assert.equal(result.state,'succeeded');assert.equal(result.outcome,'reset');assert.equal(f.store.readAutomation().appointments[0]!.consumeKey,key);assert.equal(f.store.fixtureCardConsumed('fixture-card-two'),false);
 }finally{await f.close();}});
test('休眠或离线错过不补用，取消只能在领取前，撤销边界不消费',async()=>{const f=setup();try{
 const first=await f.service.invoke('resetAppointments.create',f.input(),actor,'create');await f.service.invoke('resetAppointments.cancel',{id:first.id,expectedRevision:1},actor,'cancel');f.advance(2000);await f.service.tick();assert.equal(f.store.fixtureCardConsumed('fixture-card-one'),false);
 await f.service.invoke('resetAppointments.create',f.input(),actor,'sleep');f.advance(11001);await f.service.tick();assert.equal(f.store.readAutomation().appointments[1]!.state,'missed');assert.equal(f.store.fixtureCardConsumed('fixture-card-one'),false);
 await f.service.invoke('resetAppointments.create',f.input(),actor,'revoked');f.revoke();f.advance(1000);await f.service.tick();assert.equal(f.store.fixtureCardConsumed('fixture-card-one'),false);assert.equal(f.store.readAutomation().appointments[2]!.state,'failed');
 }finally{await f.close();}});
test('卡账号变化在最终复核时拒绝消费，未知来源不返回正常卡列表',async()=>{const f=setup();try{
 await f.service.invoke('resetAppointments.create',f.input(),actor,'create');const read=f.provider.read.bind(f.provider);f.provider.read=async()=>({...await read(),accountBinding:'other-account'});f.advance(1000);await f.service.tick();assert.equal(f.store.fixtureCardConsumed('fixture-card-one'),false);
 f.provider.read=async()=>{throw new Error('disconnect');};await assert.rejects(f.service.refresh());const snapshot=await f.service.invoke('resetCards.list',{},actor);assert.equal(snapshot.availability,'unknown');assert.equal(snapshot.items,null);
 }finally{await f.close();}});
test('第一张卡未决时，另一张已有预约不能继续消费；短休眠跨预约立即 missed',async()=>{const f=setup();try{
 await f.service.invoke('resetAppointments.create',f.input(),actor,'one');await f.service.invoke('resetAppointments.create',f.input('fixture-card-two'),actor,'two');
 const consume=f.provider.consume.bind(f.provider);f.provider.consume=async(item,guard)=>{await consume(item,guard);return {outcome:'uncertain'};};f.advance(1000);await f.service.tick();assert.equal(f.store.readAutomation().appointments[0]!.state,'uncertain');assert.equal(f.store.readAutomation().appointments[1]!.state,'pending');assert.equal(f.store.fixtureCardConsumed('fixture-card-two'),false);
 f.advance(11000);await f.service.tick();assert.equal(f.store.readAutomation().appointments[1]!.state,'missed');
 }finally{await f.close();}
 const short=setup();try{await short.service.invoke('resetAppointments.create',short.input(),actor,'sleep');short.service.suspend();short.advance(1500);short.service.resume();await short.service.tick();assert.equal(short.store.readAutomation().appointments[0]!.state,'missed');assert.equal(short.store.fixtureCardConsumed('fixture-card-one'),false);}finally{await short.close();}
});
