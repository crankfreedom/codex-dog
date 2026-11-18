import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import electron from 'electron';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {launchSmokeHost} from './electron-smoke-host.mjs';
const installed=process.argv.includes('--installed'),pack=installed?JSON.parse(await readFile('artifacts/g06/package.json','utf8')):null;
const executable=installed?resolve('artifacts/g06/installed',pack.runId,pack.executable):electron;
const cliPath=installed?join(dirname(executable),'resources/cli/codex-dog.exe'):resolve('release/g06/codex-dog.exe');
const profile='stage4-'+randomUUID().slice(0,8),directory=join(process.env.LOCALAPPDATA,'codex-dog/profiles',profile),reportDirectory='artifacts/stage4';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;let desktop,page,mcp,transport,endpoint,faultMode=false;const checks=[],pageErrors=[];
const good=result=>{assert(result.ok,result.error?.code);return result.data;};const mark=text=>{checks.push(text);console.log('[阶段4] '+text);};
let nativeNotification={status:'not-requested'};
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
async function until(check,message){const start=Date.now();while(!(await check())){if(Date.now()-start>30000)throw new Error(message);await new Promise(resolve=>setTimeout(resolve,60));}}
async function cli(args,input,client='manager'){return new Promise((done,reject)=>{const child=spawn(cliPath,[...args,'--profile',profile,'--client',client,'--json'],{windowsHide:true,env:{...env,PATH:'',NODE_OPTIONS:''},stdio:'pipe'});let output='';const timer=setTimeout(()=>{child.kill();reject(new Error('CLI 超时'));},35000);child.stdout.on('data',data=>output+=data);child.stderr.resume();child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);try{done({code,value:JSON.parse(output)});}catch{reject(new Error('CLI JSON 无效'));}});child.stdin.end(input?JSON.stringify(input):undefined);});}
const ipc=(operation,params={},key)=>page.evaluate(({operation,params,key})=>window.codexDog.request(operation,params,key),{operation,params,key});
async function launch(){({desktop,page}=await launchSmokeHost({executablePath:executable,args:[...(installed?[]:['.']),`--profile=${profile}`,'--source=fixture','--g02-test-hooks',...(faultMode?['--test-delivery-loss=1','--test-card-loss=1']:[])],env,timeout:60000},'stage4-fixture',undefined,reportDirectory));page.on('pageerror',error=>pageErrors.push(error.message));await page.waitForFunction(()=>document.getElementById('health')?.textContent?.includes('running'));endpoint=JSON.parse(await readFile(join(directory,'endpoint.json'),'utf8'));}
async function pair(name,scopes){const record=good((await cli(['access','request','--input','-'],{clientLabel:name,requestedScopes:scopes},name)).value);good(await ipc('access.grant',{id:record.id,expectedRevision:record.revision,code:record.code,scopes,expiresAt:null},randomUUID()));return record;}
async function quit(){const status=good(await ipc('app.status'));good(await ipc('app.quit',{expectedInstanceId:status.instanceId,confirm:true},randomUUID()));await until(()=>![endpoint.appPid,endpoint.brokerPid,status.workerPid].some(alive),'退出未清理本实例');await assert.rejects(access(join(directory,'endpoint.json')));await desktop.close().catch(()=>{});desktop=undefined;}
try{
 await mkdir(reportDirectory,{recursive:true});assert.equal((await cli(['tasks','list'])).value.error.code,'APP_NOT_RUNNING');await assert.rejects(access(directory));await launch();
 await pair('manager',['read','tasks.manage','content.read','messages.send','cards.manage','cards.consume','settings.manage']);await pair('reader',['read']);
 const template=good((await cli(['templates','create','--input','-','--idempotency-key','template'],{name:'自动化验收模板',body:'隔离模拟提示词'})).value);
 const conn=good(await ipc('connections.get')),threads=good(await ipc('threads.list',{connectionId:conn.connectionId}));const threadRef={connectionId:conn.connectionId,threadId:threads.items[0].threadId};
 const input={threadRef,templateRef:{templateId:template.id,revision:1},mode:'observe'};
 const task=good((await cli(['tasks','create','--input','-','--idempotency-key','create'],input)).value);assert.equal(task.enabled,false);assert.equal(task.prompt,null);
 assert.equal((await cli(['tasks','enable','--input','-','--idempotency-key','denied'],{id:task.id,confirmedRevision:1},'reader')).value.error.code,'PERMISSION_DENIED');
 assert.equal((await cli(['tasks','get','--input','-'],{id:task.id,includeContent:true},'reader')).value.error.code,'PERMISSION_DENIED');
 mark('独立 SEA CLI 已贯通模板/任务创建、默认暂停、正文脱敏及独立权限；离线不拉起');
 const target={connectionId:conn.connectionId,threadId:threads.items[4].threadId},observed=good(await ipc('threads.get',target));const sendInput={threadRef:target,prompt:'仅用于隔离模拟验收',connectionRevision:observed.connectionRevision,expectedLatestTurnId:observed.latestTurn.id,confirm:true};
 const attempt=good((await cli(['threads','send','--input','-','--idempotency-key','single-send'],sendInput)).value);assert.equal(attempt.state,'submitted');assert.equal(attempt.slot,'held');assert.equal(good((await cli(['threads','send','--input','-','--idempotency-key','single-send'],sendInput)).value).id,attempt.id);
 const receipt=good((await cli(['attempts','reconcile','--input','-','--idempotency-key','reconcile'],{id:attempt.id})).value);assert.equal(receipt.receiptMatched,true);assert.equal(receipt.state,'turn_finished');assert.equal(receipt.slot,'released');mark('单次模拟投递共用持久意图与原键，CLI 回执和轮次核对后释放槽位');
 const cards=good((await cli(['reset-cards','refresh'])).value);assert.equal(cards.source,'fixture');const appointmentInput={cardKey:cards.items[0].cardKey,scheduledAt:new Date(Date.now()+2000).toISOString(),timeZone:'Asia/Shanghai',confirm:true};
 const appointment=good((await cli(['reset-appointments','create','--input','-','--idempotency-key','appointment'],appointmentInput)).value);assert.equal(appointment.state,'pending');
 await until(async()=>good((await cli(['reset-appointments','list'])).value).items.find(x=>x.id===appointment.id).state==='succeeded','模拟卡片到期未完成');
 mark('独立 CLI 指定模拟卡预约、到期原子领取与持久结果核对通过；真实消费为零');
 if(process.argv.includes('--native-notifications')){
  await desktop.evaluate(({Notification})=>{const audit={supported:Notification.isSupported(),invoked:0,shown:0,failed:0,fixedMessages:true,instances:[]};globalThis.__dogNotificationAudit=audit;const show=Notification.prototype.show;Notification.prototype.show=function(){audit.invoked++;audit.fixedMessages&&=['额度已恢复；仅观察任务保持观察。','已核对任务完成，请查看任务归档。','重置卡预约状态有更新，请查看预约与消费核对。'].includes(this.body);this.on('show',()=>audit.shown++);this.on('failed',()=>audit.failed++);audit.instances.push(this);return show.call(this);};});
  const settings=good(await ipc('notifications.settings.get'));good(await ipc('notifications.settings.update',{expectedRevision:settings.revision,patch:{enabled:true,dailyWindow:{allDay:true}}},'native-notifications-enable'));
 }
 const goalRef={connectionId:conn.connectionId,threadId:threads.items[3].threadId},goalObserved=good(await ipc('threads.get',goalRef));assert.equal(goalObserved.latestTurnQuotaError,true);
 const goalTask=good((await cli(['tasks','create','--input','-','--idempotency-key','goal-task'],{threadRef:goalRef,prompt:'隔离模拟 Goal 全链路',mode:'auto',enabled:true,authorization:{allowAutomaticSend:true,connectionRevision:goalObserved.connectionRevision,expectedLatestTurnId:goalObserved.latestTurn.id,expectedGoalId:goalObserved.goal.current.id}})).value);
 const run=good((await cli(['scheduler','run-now','--idempotency-key','goal-run'])).value);assert.equal(good(await ipc('operations.get',{id:run.id})).state,'succeeded');
 const goalAttempt=good(await ipc('attempts.list',{taskId:goalTask.id})).items[0];assert.equal(goalAttempt.state,'submitted');good((await cli(['tasks','reconcile','--id',goalTask.id,'--idempotency-key','goal-reconcile'])).value);
 const archive=good(await ipc('archives.get',{id:goalTask.id}));assert.equal(archive.phase,'completed');assert.equal(archive.archived,true);assert.equal(archive.resumeCount,1);assert(good(await ipc('timelines.get',{id:goalTask.id})).items.some(x=>x.type==='task.completed'));
 mark('实际宿主模拟自动任务从最新额度错误到投递、唯一回执、Goal 完成与归档贯通，调度操作可独立核对');
 if(process.argv.includes('--native-notifications')){
  await new Promise(done=>setTimeout(done,2500));nativeNotification=await desktop.evaluate(()=>{const {supported,invoked,shown,failed,fixedMessages}=globalThis.__dogNotificationAudit;return {status:shown?'shown':supported?'not-observed':'unsupported',supported,invoked,shown,failed,fixedMessages};});assert.equal(nativeNotification.fixedMessages,true);
  const settings=good(await ipc('notifications.settings.get'));good(await ipc('notifications.settings.update',{expectedRevision:settings.revision,patch:{enabled:false}},'native-notifications-disable'));await desktop.evaluate(()=>{for(const notification of globalThis.__dogNotificationAudit.instances)notification.close();});
  console.log('[阶段4] 原生通知展示证据 '+JSON.stringify(nativeNotification));
 }
 if(!process.argv.includes('--cli-only')){
 transport=new StdioClientTransport({command:cliPath,args:['mcp','serve','--profile',profile,'--client','manager'],env:{...env,PATH:'',NODE_OPTIONS:''},stderr:'pipe'});mcp=new Client({name:'stage4-acceptance',version:'1'});await mcp.connect(transport);transport.stderr?.resume();
 assert.deepEqual(good((await mcp.callTool({name:'tasks_create',arguments:{...input,idempotencyKey:'create'}})).structuredContent),task);
 good(await ipc('templates.update',{id:template.id,expectedRevision:1,patch:{body:'新版模板'}},'template-edit'));
 const copied=good((await mcp.callTool({name:'templates_create',arguments:{name:'复制模板验收',copyOfId:template.id,expectedSourceRevision:2,idempotencyKey:'template-copy'}})).structuredContent);
 const defaulted=good((await cli(['templates','set-default','--input','-','--idempotency-key','template-default'],{id:copied.id,expectedRevision:1})).value);assert.equal(defaulted.isDefault,true);
 const copiedBody=good((await cli(['templates','get','--input','-'],{id:copied.id,includeContent:true})).value);assert.equal(copiedBody.body,'新版模板');good(await ipc('templates.delete',{id:copied.id,expectedRevision:2},'template-delete'));good(await ipc('templates.setDefault',{id:template.id,expectedRevision:2},'restore-default'));const remainingTemplates=good((await mcp.callTool({name:'templates_list',arguments:{}})).structuredContent).items;assert(!remainingTemplates.some(x=>x.id===copied.id));assert(remainingTemplates.some(x=>x.id===template.id&&x.isDefault));
 assert.equal(good((await cli(['tasks','get','--input','-'],{id:task.id,includeContent:true})).value).prompt,'隔离模拟提示词');
 good(await ipc('tasks.enable',{id:task.id,confirmedRevision:1},'enable'));good((await cli(['tasks','pause','--input','-','--idempotency-key','pause'],{id:task.id})).value);
 const edited=good((await mcp.callTool({name:'tasks_update',arguments:{id:task.id,expectedRevision:1,patch:{prompt:'任务独立修订'},idempotencyKey:'edit'}})).structuredContent);assert.equal(edited.enabled,false);assert.equal(edited.revision,2);
 mark('CLI/IPC/MCP 共享任务/模板处理器及幂等；模板变化不追改任务，暂停编辑保持暂停');
 const invokeMcp=async(name,arguments_)=>good((await mcp.callTool({name,arguments:arguments_})).structuredContent);
 for(const [operation,command,tool,params] of [['tasks.policy.get',['tasks','policy','get'],'tasks_policy_get',{id:task.id}],['tasks.revisions.list',['tasks','revisions','list'],'tasks_revisions_list',{id:task.id}],['timelines.get',['timelines','get'],'timelines_get',{id:task.id}],['attempts.get',['attempts','get'],'attempts_get',{id:attempt.id}],['queue.get',['queue','get'],'queue_get',{}]]){
  const current=good(await ipc(operation,params));assert.deepEqual(good((await cli([...command,'--input','-'],params)).value),current);assert.deepEqual(await invokeMcp(tool,params),current);
 }
 assert.deepEqual(await invokeMcp('threads_send',{...sendInput,idempotencyKey:'single-send'}),good(await ipc('attempts.get',{id:attempt.id})));
 const queue=good(await ipc('queue.get'));good((await cli(['queue','configure','--input','-','--idempotency-key','configure-queue'],{expectedRevision:queue.revision,enabled:true,limit:2})).value);
 const extra=await invokeMcp('tasks_create',{threadRef:{connectionId:conn.connectionId,threadId:threads.items[2].threadId},prompt:'隔离归档任务',idempotencyKey:'extra-task'});
 const configured=good(await ipc('queue.get'));good((await cli(['tasks','reorder','--input','-','--idempotency-key','move-extra'],{id:extra.id,direction:'up',expectedQueueRevision:configured.revision})).value);
 const inspection=good((await cli(['tasks','inspect','--id',task.id])).value);assert.equal(inspection.providerChecked,true);assert(inspection.reasons.includes('paused'));
 good((await cli(['tasks','remove','--input','-','--idempotency-key','archive-extra'],{id:extra.id,expectedRevision:1})).value);assert((await invokeMcp('archives_list',{})).items.some(x=>x.id===extra.id));assert.equal((await invokeMcp('archives_get',{id:extra.id})).archived,true);
 const schedule=good(await ipc('scheduler.settings.get'));good((await cli(['scheduler','settings','update','--input','-','--idempotency-key','schedule-settings'],{expectedRevision:schedule.revision,enabled:false,pollSeconds:30})).value);assert.equal((await invokeMcp('scheduler_settings_get',{})).enabled,false);
 const notifications=good(await ipc('notifications.settings.get'));await invokeMcp('notifications_settings_update',{expectedRevision:notifications.revision,patch:{enabled:false},idempotencyKey:'notification-settings'});assert.equal(good((await cli(['notifications','settings','get'])).value).enabled,false);
 assert.equal((await cli(['operations','cancel','--id',run.id,'--idempotency-key','cannot-cancel-completed'])).value.error.code,'OPERATION_IRREVERSIBLE');assert.equal((await invokeMcp('reset_cards_list',{})).source,'fixture');assert((await invokeMcp('reset_appointments_list',{})).items.some(x=>x.id===appointment.id));
 mark('模板复制/默认/删除、任务策略/修订/诊断/归档、队列和独立设置贯通三入口，原发送键跨 MCP 不重放，已完成调度不可撤回');
 if(process.argv.includes('--ui')){
  await page.getByRole('button',{name:'任务与模板',exact:true}).click();await page.getByRole('button',{name:'读取提示词与编辑',exact:true}).click();await until(async()=>await page.getByLabel('任务提示词',{exact:true}).inputValue()==='任务独立修订','页面任务提示词读取失败');await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:reportDirectory+'/tasks.png',fullPage:true});
  await page.getByRole('button',{name:'重置卡预约',exact:true}).click();await page.getByRole('button',{name:'刷新卡片明细',exact:true}).click();await page.getByLabel('选择模拟重置卡 2',{exact:true}).check();const when=new Date(Date.now()+60000),local=new Date(when.getTime()-when.getTimezoneOffset()*60000).toISOString().slice(0,19);await page.getByLabel('卡片预约时间',{exact:true}).fill(local);await page.getByLabel('确认指定卡消费预约',{exact:true}).check();await page.getByRole('button',{name:'保存指定卡预约',exact:true}).click();await page.getByRole('button',{name:'取消未领取预约',exact:true}).waitFor();await page.getByRole('button',{name:'取消未领取预约',exact:true}).click();await until(async()=>good(await ipc('resetAppointments.list')).items.some(x=>x.state==='cancelled'),'页面取消卡预约失败');await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:reportDirectory+'/cards.png',fullPage:true});
  await page.getByRole('button',{name:'调度与投递',exact:true}).click();await page.getByRole('heading',{name:'统一调度与并发槽位',exact:true}).waitFor();await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:reportDirectory+'/delivery.png',fullPage:true});await page.getByRole('button',{name:'安装与更新',exact:true}).click();await page.getByRole('heading',{name:'安装与更新',exact:true}).waitFor();await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:reportDirectory+'/updates.png',fullPage:true});mark('任务/卡预约取消/调度投递/更新页面实际交互和渲染通过');
 }
 await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());assert.equal(good((await cli(['tasks','list'])).value).items.length,1);good((await cli(['desktop','show'])).value);mark('窗口关闭驻托盘后 CLI/MCP 保持可查询');
 await quit();await launch();assert.equal(good((await cli(['tasks','get','--input','-'],{id:task.id,includeContent:true})).value).prompt,'任务独立修订');
 const grants=good(await ipc('access.list')).clients.find(x=>x.label==='manager');good(await ipc('access.revoke',{id:grants.id,expectedRevision:grants.revision},'revoke'));assert.equal((await cli(['tasks','list'])).value.error.code,'AUTH_REVOKED');mark('业务修订重启保留、旧授权不扩权，撤销即时拒绝');
 }
 if(process.argv.includes('--faults')){
  await quit();faultMode=true;await launch();let selected=good(await ipc('connections.get'));const ref={connectionId:selected.connectionId,threadId:threads.items[4].threadId},view=good(await ipc('threads.get',ref));const input={threadRef:ref,prompt:'模拟响应丢失故障注入',connectionRevision:view.connectionRevision,expectedLatestTurnId:view.latestTurn.id,confirm:true};
  const lost=good(await ipc('threads.send',input,'lost-response'));assert.equal(lost.state,'uncertain');assert.equal(lost.slot,'held');
  const cardView=good(await ipc('resetCards.refresh')),second=cardView.items.find(x=>x.status==='available');assert(second);
  const missed=good(await ipc('resetAppointments.create',{cardKey:second.cardKey,scheduledAt:new Date(Date.now()+700).toISOString(),timeZone:'Asia/Shanghai',confirm:true},'sleep-missed'));await desktop.evaluate(({powerMonitor})=>powerMonitor.emit('suspend'));await new Promise(done=>setTimeout(done,1100));await desktop.evaluate(({powerMonitor})=>powerMonitor.emit('resume'));await until(async()=>good(await ipc('resetAppointments.list')).items.find(x=>x.id===missed.id).state==='missed','短休眠事件跨过预约后未标错过');
  const cardLost=good(await ipc('resetAppointments.create',{cardKey:second.cardKey,scheduledAt:new Date(Date.now()+700).toISOString(),timeZone:'Asia/Shanghai',confirm:true},'lost-card'));await until(async()=>good(await ipc('resetAppointments.list')).items.find(x=>x.id===cardLost.id).state==='uncertain','模拟卡响应丢失未保留未决');
  await quit();faultMode=false;await launch();assert.equal(good(await ipc('attempts.get',{id:lost.id})).state,'uncertain');assert.equal(good(await ipc('resetAppointments.list')).items.find(x=>x.id===cardLost.id).calls,1);
  selected=good(await ipc('connections.get'));const currentRef={connectionId:selected.connectionId,threadId:ref.threadId},currentView=good(await ipc('threads.get',currentRef));const blocked=await ipc('threads.send',{...input,threadRef:currentRef,connectionRevision:currentView.connectionRevision,expectedLatestTurnId:currentView.latestTurn.id},'new-key-cannot-bypass');assert.equal(blocked.error.code,'UNRESOLVED_ATTEMPT');
  assert.equal(good(await ipc('attempts.reconcile',{id:lost.id},'original-receipt')).slot,'released');const reconciled=good(await ipc('resetAppointments.reconcile',{id:cardLost.id,confirmMayComplete:true},'original-card-key'));assert.equal(reconciled.state,'succeeded');assert.equal(good(await ipc('attempts.list',{limit:200})).items.length,3);
  mark('实际 worker 的模拟写后响应丢失、短休眠事件、退出重启保留、原意图/原卡核对及历史租约终态释放通过，无自动重放');
 }
 await quit();assert.equal((await cli(['tasks','list'])).value.error.code,'APP_NOT_RUNNING');assert.deepEqual(pageErrors,[]);
 await writeFile(`${reportDirectory}/${installed?'installed':'development'}${process.argv.includes('--cli-only')?'-cli':''}.json`,JSON.stringify({result:'passed',evidence:'fixture',installed,checks,pageErrors,nativeNotification,realMessageSends:0,realResetConsumptions:0,fixtureMessageWrites:process.argv.includes('--faults')?3:2,fixtureResetConsumptions:process.argv.includes('--faults')?2:1,powerEvents:process.argv.includes('--faults')?'simulated-electron-suspend-resume':'not-tested',githubActionsRun:process.env.GITHUB_ACTIONS==='true',githubRunId:process.env.GITHUB_RUN_ID??null,createdAt:new Date().toISOString()},null,2));
}finally{await mcp?.close().catch(()=>{});await transport?.close().catch(()=>{});await desktop?.close().catch(()=>{});}
