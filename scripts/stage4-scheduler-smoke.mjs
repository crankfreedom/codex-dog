import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {launchSmokeHost} from './electron-smoke-host.mjs';
const pack=JSON.parse(await readFile('artifacts/g06/package.json','utf8')),profile='timer-'+randomUUID().slice(0,8),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
let desktop;const good=result=>{assert(result.ok,result.error?.code);return result.data;};
try{
 const host=await launchSmokeHost({executablePath:resolve('artifacts/g06/installed',pack.runId,pack.executable),args:[`--profile=${profile}`,'--source=fixture'],env,timeout:60000},'scheduler-timer',undefined,'artifacts/stage4');desktop=host.desktop;const page=host.page;await page.waitForFunction(()=>document.getElementById('health')?.textContent?.includes('running'));
 const request=(operation,params={},key)=>page.evaluate(({operation,params,key})=>window.codexDog.request(operation,params,key),{operation,params,key});
 const connection=good(await request('connections.get')),threads=good(await request('threads.list',{connectionId:connection.connectionId})),ref={connectionId:connection.connectionId,threadId:threads.items[3].threadId},view=good(await request('threads.get',ref));
 const task=good(await request('tasks.create',{threadRef:ref,prompt:'仅用于隔离定时调度验收',mode:'auto',enabled:true,authorization:{allowAutomaticSend:true,connectionRevision:view.connectionRevision,expectedLatestTurnId:view.latestTurn.id,expectedGoalId:view.goal.current.id}},'timer-task'));
 const before=good(await request('scheduler.settings.get'));assert.equal(before.enabled,false);const startedAt=Date.now();good(await request('scheduler.settings.update',{expectedRevision:before.revision,enabled:true,pollSeconds:10},'timer-on'));assert.equal(good(await request('attempts.list',{taskId:task.id})).items.length,0);
 let completed=false;while(Date.now()-startedAt<35000){await new Promise(done=>setTimeout(done,300));const current=good(await request('tasks.list'));if(!current.items.some(x=>x.id===task.id)){completed=true;break;}}
 assert(completed,'定时调度未自行完成投递/核对/归档');const attempts=good(await request('attempts.list',{taskId:task.id})).items;assert.equal(attempts.length,1);assert.equal(attempts[0].state,'turn_finished');assert.equal(attempts[0].slot,'released');assert.equal(good(await request('archives.get',{id:task.id})).resumeCount,1);assert(Date.now()-startedAt>=19000);
 const current=good(await request('scheduler.settings.get'));good(await request('scheduler.settings.update',{expectedRevision:current.revision,enabled:false,pollSeconds:10},'timer-off'));assert.equal(good(await request('scheduler.settings.get')).enabled,false);
 const status=good(await request('app.status'));good(await request('app.quit',{expectedInstanceId:status.instanceId,confirm:true},randomUUID()));await desktop.close().catch(()=>{});desktop=undefined;
 const report={result:'passed',version:pack.version,installed:true,evidence:'fixture-real-application-timers',profile,manualRunNowCalls:0,automaticDispatches:1,fixtureMessageWrites:1,realMessageSends:0,realResetConsumptions:0,checks:['保存周期不立即发送','两个实际十秒周期独立完成唯一投递、回执核对和 Goal 归档','关闭独立任务周期后查询为关闭，并明确退出'],createdAt:new Date().toISOString()};await writeFile('artifacts/stage4/scheduler-timer.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await desktop?.close().catch(()=>{});}
