import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SqliteStore} from '../packages/infrastructure/sqlite-store.ts';
import {NotificationService} from '../packages/modules/notifications/service.ts';
import type {AutomationPorts} from '../packages/modules/automation/ports.ts';
const actor={kind:'desktop' as const,clientId:'desktop',revision:1};
test('通知默认关闭，固定消息不含正文，持久游标去重且时段外丢弃不补发',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'dog-notify-')),store=new SqliteStore(join(directory,'app.sqlite'));store.start();let now=new Date(2026,10,17,10).getTime();const shown:string[]=[];
 const ports:AutomationPorts={now:()=>now,newId:randomUUID,digest:x=>createHash('sha256').update(x).digest('hex'),authorize:async()=>{},observe:async()=>{throw new Error();}};
 const service=new NotificationService(store,ports,kind=>shown.push(kind),()=>()=>{});service.start();
 const event=(reason:string)=>{const state=store.readAutomation();store.commitAutomation(state.version,state,{resourceId:randomUUID(),at:new Date(now).toISOString(),type:'task.observed',reason,revision:1});};
 try{event('observation_quota_recovered');service.flush();assert.deepEqual(shown,[]);
 await service.invoke('notifications.settings.update',{expectedRevision:1,patch:{enabled:true,dailyWindow:{allDay:false,start:'09:00',end:'12:00'}}},actor,'enable');event('observation_quota_recovered');service.flush();assert.deepEqual(shown,['quota_recovered']);service.flush();assert.equal(shown.length,1);
 service.close();store.close();store.start();service.start();service.flush();assert.equal(shown.length,1);
 now=new Date(2026,10,17,13).getTime();event('observation_quota_recovered');service.flush();assert.equal(shown.length,1);now=new Date(2026,10,18,10).getTime();service.flush();assert.equal(shown.length,1);
 }finally{service.close();store.close();rmSync(directory,{recursive:true,force:true});}
});
