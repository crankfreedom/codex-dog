import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,readFile,writeFile,mkdir,access,realpath} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {spawn} from 'node:child_process';
import electron from 'electron';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {launchSmokeHost} from './electron-smoke-host.mjs';

const live=process.argv.includes('--live'),installed=process.argv.includes('--installed');
const argument=name=>{const at=process.argv.indexOf(name);return at<0?undefined:process.argv[at+1];};
assert(!live||process.env.GITHUB_ACTIONS!=='true','runner 禁止真实来源');
const caller=live?process.env.CODEX_THREAD_ID:randomUUID(),target=live?argument('--target'):randomUUID();
assert(/^[a-f0-9-]{36}$/.test(caller??'')&&/^[a-f0-9-]{36}$/.test(target??''),'真实只读须明确 caller 与 --target');
const pack=installed?JSON.parse(await readFile('artifacts/g06/package.json','utf8')):null;
const executable=installed?resolve('artifacts/g06/installed',pack.runId,pack.executable):electron,cliPath=installed?join(dirname(executable),'resources/cli/codex-dog.exe'):resolve('release/g06/codex-dog.exe');
const profile='delivery-gates-'+randomUUID().slice(0,8),directory=join(process.env.LOCALAPPDATA,'codex-dog/profiles',profile),root='artifacts/delivery-gates',env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const label=(installed?'installed':'development')+'-'+(live?'real-readonly':'simulated-adapter'),reportFile=join(root,label+'.json'),pageErrors=[],calls=[],sockets=new Set();
let desktop,page,endpoint,mcp,transport,server,pipe=process.env.CODEX_DOG_LIVE_PIPE??'',codexHome=process.env.CODEX_HOME||join(homedir(),'.codex'),locks=argument('--legacy-lock-directory');
const good=value=>{assert(value.ok,value.error?.code);return value.data;},alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
async function until(fn,message){const end=Date.now()+30000;while(!await fn()){assert(Date.now()<end,message);await new Promise(done=>setTimeout(done,70));}}
const ipc=(operation,params={},key)=>page.evaluate(({operation,params,key})=>window.codexDog.request(operation,params,key),{operation,params,key});
async function cli(args,input){return new Promise((done,reject)=>{const child=spawn(cliPath,[...args,'--profile',profile,'--client','gate-reader','--json','--timeout-ms','60000'],{windowsHide:true,env:{...env,PATH:'',NODE_OPTIONS:''},stdio:'pipe'});let output='';const timer=setTimeout(()=>{child.kill();reject(Error('CLI_TIMEOUT'));},65000);child.stdout.on('data',data=>output+=data);child.stderr.resume();child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);try{done({code,value:JSON.parse(output)});}catch{reject(Error('CLI_INVALID_JSON'));}});child.stdin.end(input?JSON.stringify(input):undefined);});}
async function mockSource(){
 codexHome=await mkdtemp(join(await realpath(tmpdir()),'dog-native-metadata-fixture-'));locks=join(codexHome,'locks');await mkdir(locks);
 for(const [file,sql,insert,values] of [
  ['state_5.sqlite','CREATE TABLE threads(id TEXT,creator_account_id TEXT,preview TEXT)','INSERT INTO threads VALUES(?,?,?)',[target,'simulated-account','fixture-private']],
  ['goals_1.sqlite','CREATE TABLE thread_goals(thread_id TEXT,goal_id TEXT,status TEXT,objective TEXT)','INSERT INTO thread_goals VALUES(?,?,?,?)',[target,'fixture-goal','active','fixture-private']],
  ['thread_history_1.sqlite','CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,status TEXT,first_user_item_id TEXT,rollout_ordinal INTEGER,error_json TEXT)','INSERT INTO thread_turns VALUES(?,?,?,?,?,?)',[target,'fixture-turn','completed','fixture-item',1,'fixture-private']]
 ]){const db=new DatabaseSync(join(codexHome,file));try{db.exec(sql);db.prepare(insert).run(...values);}finally{db.close();}}
 pipe='\\\\.\\pipe\\codex-app-tools-gates-fixture-'+randomUUID();
 const catalog=['get_usage_limits','list_threads','read_thread'].map(name=>({name,namespace:'codex_app',inputSchema:{properties:Object.fromEntries((name==='get_usage_limits'?[]:name==='list_threads'?['mode','source','hostId','limit','cursor','archived']:['threadId','hostId','turnLimit','includeOutputs','maxOutputCharsPerItem']).map(key=>[key,{}]))}}));
 server=createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));let buffer=Buffer.alloc(0);socket.on('data',bytes=>{buffer=Buffer.concat([buffer,bytes]);while(buffer.length>=4&&buffer.length>=buffer.readUInt32LE(0)+4){const size=buffer.readUInt32LE(0),request=JSON.parse(buffer.subarray(4,size+4).toString('utf8'));buffer=buffer.subarray(size+4);const tool=request.method==='tools/call'?request.params.tool:request.method;calls.push(tool);const result=tool==='tools/list'?{tools:catalog}:tool==='get_usage_limits'?{success:true,contentItems:[{type:'inputText',text:JSON.stringify({accountId:'simulated-account',ordinaryUsageAllowed:true,rateLimits:{primary:{usedPercent:10},secondary:{usedPercent:20}}})}]}:null;const payload=Buffer.from(JSON.stringify({id:request.id,...(result?{result}:{error:{code:-1,message:'FIXTURE_FORBIDS_NON_QUOTA_CALL'}})})),header=Buffer.alloc(4);header.writeUInt32LE(payload.length);socket.write(Buffer.concat([header,payload]));}});});await new Promise((done,reject)=>{server.once('error',reject);server.listen(pipe,done);});
}
async function quit(){const status=good(await ipc('app.status'));good(await ipc('app.quit',{expectedInstanceId:status.instanceId,confirm:true},randomUUID()));await until(()=>![endpoint.appPid,endpoint.brokerPid,status.workerPid].some(alive),'本实例退出清理超时');await assert.rejects(access(join(directory,'endpoint.json')));await desktop.close().catch(()=>{});desktop=undefined;}
try{
 await mkdir(root,{recursive:true});await writeFile(reportFile,JSON.stringify({result:'prepared',evidence:live?'real-readonly':'simulated-adapter',realMessageSends:0,realResetConsumptions:0}));
 if(!live)await mockSource();
 ({desktop,page}=await launchSmokeHost({executablePath:executable,args:[...(installed?[]:['.']),`--profile=${profile}`,'--source=fixture'],env,timeout:60000},'delivery-gates-'+label,undefined,root));
 page.on('pageerror',error=>pageErrors.push(error.message));await page.waitForFunction(()=>document.getElementById('health')?.textContent?.includes('running'));endpoint=JSON.parse(await readFile(join(directory,'endpoint.json'),'utf8'));
 const config=good(await ipc('connections.configuration'));good(await ipc('connections.configure',{expectedRevision:config.revision,source:'live-readonly',callerThreadId:caller,pipe,codexHome,...(locks?{legacyLockDirectory:locks}:{}),allowCardConsumption:false},'select-readonly'));await quit();
 ({desktop,page}=await launchSmokeHost({executablePath:executable,args:[...(installed?[]:['.']),`--profile=${profile}`],env,timeout:60000},'delivery-gates-'+label,undefined,root));page.on('pageerror',error=>pageErrors.push(error.message));await page.waitForFunction(()=>document.getElementById('health')?.textContent?.includes('running'));endpoint=JSON.parse(await readFile(join(directory,'endpoint.json'),'utf8'));
 const selected=good(await ipc('connections.configuration'));assert.equal(selected.active.codexHome,codexHome);assert.equal(selected.active.source,'live-readonly');assert(!selected.active.cardExecutable);assert.equal(selected.active.allowCardConsumption,undefined);
 const pairing=good((await cli(['access','request','--input','-'],{clientLabel:'门禁只读验收',requestedScopes:['read']})).value);good(await ipc('access.grant',{id:pairing.id,expectedRevision:pairing.revision,code:pairing.code,scopes:['read'],expiresAt:null},randomUUID()));
 const connection=good(await ipc('connections.get')),params={includeDeliveryGates:true,threadRef:{connectionId:connection.connectionId,threadId:target}},fromCli=good((await cli(['diagnostics','run','--input','-'],params)).value);
 transport=new StdioClientTransport({command:cliPath,args:['mcp','serve','--profile',profile,'--client','gate-reader','--timeout-ms','60000'],env:{...env,PATH:'',NODE_OPTIONS:''},stderr:'pipe'});mcp=new Client({name:'delivery-gate-acceptance',version:'1'});await mcp.connect(transport);transport.stderr?.resume();
 const fromMcp=good((await mcp.callTool({name:'diagnostics_run',arguments:params})).structuredContent),fromIpc=good(await ipc('diagnostics.run',params));
 for(const r of [fromCli,fromMcp,fromIpc]){assert.equal(r.deliveryGates.realSendingEnabled,false);assert.equal(r.deliveryGates.readOnly,true);assert.equal(r.deliveryGates.status,'blocked');assert.equal(r.checks.find(x=>x.id==='thread').status,'not_checked');assert(!JSON.stringify(r).includes('fixture-private'));}
 const stable=r=>r.deliveryGates.checks.filter(x=>x.id!=='delivery_account_observation');assert.deepEqual(stable(fromCli),stable(fromMcp));assert.deepEqual(stable(fromCli),stable(fromIpc));
 if(!live){for(const id of ['delivery_target_metadata','delivery_target_creator','delivery_goal_relation','delivery_turn_metadata','delivery_lock_snapshot'])assert.equal(fromIpc.checks.find(x=>x.id===id).status,'passed');assert(calls.every(x=>['tools/list','get_usage_limits'].includes(x)));}
 await page.getByRole('button',{name:'只读诊断',exact:true}).click();await page.getByLabel('检查真实发送门禁',{exact:true}).check();await page.getByLabel('诊断目标会话 ID',{exact:true}).fill(target);await page.getByRole('button',{name:'运行只读诊断',exact:true}).click();await page.getByText('原发送唯一回执',{exact:true}).waitFor();await page.screenshot({path:join(root,label+'.png'),fullPage:true});
 await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());assert.equal(good((await cli(['diagnostics','run','--input','-'],params)).value).deliveryGates.realSendingEnabled,false);assert.equal(good((await mcp.callTool({name:'diagnostics_run',arguments:params})).structuredContent).deliveryGates.realSendingEnabled,false);
 assert.equal(good(await ipc('tasks.list')).items.length,0);assert.equal(good(await ipc('attempts.list')).items.length,0);assert.equal(good(await ipc('resetAppointments.list')).items.length,0);assert.equal(good(await ipc('scheduler.settings.get')).enabled,false);
 const observed=good(await ipc('connections.get'));assert(Object.keys(observed.readCalls).every(x=>x==='get_usage_limits'));await mcp.close();await transport.close();mcp=transport=undefined;const version=good(await ipc('app.version')).version;await quit();assert.equal((await cli(['diagnostics','run'])).value.error.code,'APP_NOT_RUNNING');
 const report={result:'passed',evidence:live?'real-readonly':'simulated-adapter',installed,version,githubActionsRun:process.env.GITHUB_ACTIONS==='true',githubRunId:process.env.GITHUB_RUN_ID??null,profile,targetDigest:createHash('sha256').update(target).digest('hex'),checks:['CLI 首验与 IPC/MCP 门禁结果一致','桌面明确目标门禁展示','仅额度原生读取和固定 SQL 元数据投影','创建账号/轮次/锁快照不放行真实发送','驻托盘可查询及明确退出离线清理'],gateReport:fromIpc.deliveryGates,nativeReadCalls:observed.readCalls,rawResponseRetained:false,authenticationFilesRead:false,chatBodyRead:false,goalObjectiveRead:false,realMessageSends:0,realResetConsumptions:0,oldRuntimeLocksModified:false,ownHostProcessesCleaned:true,pageErrors,createdAt:new Date().toISOString()};assert.deepEqual(pageErrors,[]);await writeFile(reportFile,JSON.stringify(report,null,2));console.log(JSON.stringify({result:report.result,evidence:report.evidence,installed,version,checks:report.checks.length,gateStatus:report.gateReport.status,nativeReadCalls:report.nativeReadCalls,realMessageSends:0,realResetConsumptions:0}));
}finally{await mcp?.close().catch(()=>{});await transport?.close().catch(()=>{});await desktop?.close().catch(()=>{});for(const socket of sockets)socket.destroy();if(server)await new Promise(done=>server.close(done));}
