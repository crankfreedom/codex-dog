<script setup lang="ts">
import {onMounted,ref} from 'vue';
import {readSubmissionObservation} from './submission-observation.ts';
import {ElButton} from 'element-plus';
import {useDesktop} from './store.ts';
import type {OperationName} from '../../../packages/contracts/protocol.ts';
const store=useDesktop(),error=ref(''),busy=ref(false),tasks=ref<Record<string,any>[]>([]),templates=ref<Record<string,any>[]>([]),archived=ref(false),details=ref('');
const selected=ref<Record<string,any>|null>(null),connectionId=ref(''),threadId=ref(''),body=ref(''),mode=ref('observe'),maxResumes=ref(3),priority=ref('normal'),expires=ref(''),allDay=ref(true),start=ref('09:00'),end=ref('18:00'),approve=ref(false),templateId=ref('');
const phaseLabels:Record<string,string>={suspended:'暂停或阻断',observing:'观察中',waiting_quota:'等待额度',sending:'投递中',verifying:'等待核对',completed:'已完成',send_uncertain:'发送结果未决'};
const templateName=ref(''),templateBody=ref(''),editingTemplate=ref<Record<string,any>|null>(null);
async function run(work:()=>Promise<void>){if(busy.value)return;busy.value=true;error.value='';try{await work();}catch(e){error.value=(e as Error).message;}finally{busy.value=false;}}
async function load(){tasks.value=(await store.request(archived.value?'archives.list':'tasks.list',{limit:200})).items as Record<string,any>[];templates.value=(await store.request('templates.list',{limit:200})).items as Record<string,any>[];if(!templateId.value)templateId.value=String(templates.value.find(x=>x.isDefault)?.id??'');}
onMounted(()=>run(async()=>{const conn=await store.request('connections.get');connectionId.value=String(conn.connectionId);await load();}));
function reset(){selected.value=null;body.value='';threadId.value='';mode.value='observe';maxResumes.value=3;priority.value='normal';expires.value='';allDay.value=true;approve.value=false;}
async function edit(item:Record<string,any>){await run(async()=>{const task=await store.request(archived.value?'archives.get':'tasks.get',{id:item.id,includeContent:true});selected.value=task;body.value=String(task.prompt);threadId.value=String((task.threadRef as any).threadId);connectionId.value=String((task.threadRef as any).connectionId);mode.value=String(task.mode);maxResumes.value=Number(task.maxResumes);priority.value=String(task.priority);expires.value=task.expiresAt?new Date(new Date(String(task.expiresAt)).getTime()-new Date(String(task.expiresAt)).getTimezoneOffset()*60000).toISOString().slice(0,16):'';const window=task.dailyWindow as any;allDay.value=window.allDay;start.value=window.start??'09:00';end.value=window.end??'18:00';approve.value=false;});}
function config(){return {prompt:body.value,mode:mode.value,maxResumes:maxResumes.value,priority:priority.value,expiresAt:expires.value?new Date(expires.value).toISOString():null,dailyWindow:allDay.value?{allDay:true}:{allDay:false,start:start.value,end:end.value}};}
async function save(){await run(async()=>{if(selected.value)await store.request('tasks.update',{id:selected.value.id,expectedRevision:selected.value.revision,patch:config()},crypto.randomUUID());else{const input:Record<string,unknown>={...config(),threadRef:{connectionId:connectionId.value,threadId:threadId.value}};if(!body.value&&templateId.value){delete input.prompt;input.templateRef={templateId:templateId.value,revision:templates.value.find(x=>x.id===templateId.value)?.revision};}await store.request('tasks.create',input,crypto.randomUUID());}reset();await load();});}
async function action(operation:OperationName,item:Record<string,any>){await run(async()=>{const params:Record<string,unknown>={id:item.id};if(operation==='tasks.enable'){params.confirmedRevision=item.revision;params.connectionId=(await store.request('connections.get')).connectionId;if(item.mode==='auto'){if(!approve.value)throw new Error('请明确勾选当前目标自动发送授权');const observed=await readSubmissionObservation(store.request,{...item.threadRef,connectionId:String(params.connectionId)});params.authorization={allowAutomaticSend:true,connectionRevision:observed.connectionRevision,expectedLatestTurnId:(observed.latestTurn as any)?.id??null,expectedGoalId:(observed.goal as any)?.current?.id??null};}}if(operation==='tasks.remove')params.expectedRevision=item.revision;await store.request(operation,params,crypto.randomUUID());approve.value=false;await load();});}
async function inspect(operation:OperationName,item:Record<string,any>){await run(async()=>{details.value=JSON.stringify(await store.request(operation,{id:item.id}),null,2);});}
async function templateEdit(item:Record<string,any>){await run(async()=>{const value=await store.request('templates.get',{id:item.id,includeContent:true});editingTemplate.value=value;templateName.value=String(value.name);templateBody.value=String(value.body);});}
async function templateSave(){await run(async()=>{await store.request(editingTemplate.value?'templates.update':'templates.create',editingTemplate.value?{id:editingTemplate.value.id,expectedRevision:editingTemplate.value.revision,patch:{name:templateName.value,body:templateBody.value}}:{name:templateName.value,body:templateBody.value},crypto.randomUUID());editingTemplate.value=null;templateName.value='';templateBody.value='';await load();});}
async function templateAction(operation:OperationName,item:Record<string,any>){await run(async()=>{await store.request(operation,{id:item.id,expectedRevision:item.revision},crypto.randomUUID());await load();});}
async function copyTemplate(item:Record<string,any>){await run(async()=>{await store.request('templates.create',{name:String(item.name).slice(0,76)+' 副本',copyOfId:item.id,expectedSourceRevision:item.revision},crypto.randomUUID());await load();});}
</script>
<template>
 <section aria-label="任务与模板">
  <p class="notice">{{store.mode==='fixture'?'当前为隔离模拟，任务行为不代表真实投递已验收。':'真实账号/目标绑定与旧锁门禁通过后，方可启用真实自动发送。'}}暂停只停止后续投递，未决发送必须保留并核对。</p>
  <p v-if="error" role="alert" class="notice">{{error}}</p>
  <section class="panel"><h2>{{selected?'编辑暂停任务':'创建任务'}}</h2>
   <label>连接 ID<input v-model="connectionId" aria-label="任务连接 ID" :disabled="!!selected" /></label><label>会话 ID<input v-model="threadId" aria-label="任务会话 ID" :disabled="!!selected" /></label>
   <label>提示词<textarea v-model="body" aria-label="任务提示词" maxlength="10000" rows="4"></textarea></label>
   <label v-if="!selected">正文为空时使用模板<select v-model="templateId" aria-label="任务模板"><option value="">选择模板</option><option v-for="item in templates" :key="item.id" :value="item.id">{{item.name}}{{item.isDefault?'（默认）':''}}</option></select></label>
   <label>模式<select v-model="mode" aria-label="任务模式"><option value="observe">仅观察</option><option value="auto">自动续跑</option></select></label>
   <label>累计次数上限<input v-model.number="maxResumes" aria-label="任务次数上限" type="number" min="1" max="20" /></label>
   <label>优先级<select v-model="priority" aria-label="任务优先级"><option value="high">高</option><option value="normal">普通</option><option value="low">低</option></select></label>
   <label>有效期至<input v-model="expires" aria-label="任务有效期" type="datetime-local" /></label>
   <label><input v-model="allDay" type="checkbox" />全天允许</label><template v-if="!allDay"><label>每日开始<input v-model="start" type="time" aria-label="任务每日开始" /></label><label>每日结束<input v-model="end" type="time" aria-label="任务每日结束" /></label><p class="muted">跟随本机时区，支持跨午夜；开始包含，结束不包含。</p></template>
   <ElButton type="primary" :disabled="busy||archived" @click="save">{{selected?'保存修订并保持暂停':'创建暂停任务'}}</ElButton><ElButton @click="reset">清空任务表单</ElButton>
  </section>
  <section class="panel"><h2>托管任务</h2><label><input v-model="archived" type="checkbox" @change="run(load)" />显示归档</label><ElButton :disabled="busy" @click="run(load)">刷新任务列表</ElButton>
   <label><input v-model="approve" type="checkbox" aria-label="明确授权当前目标自动发送" />启用自动模式时，明确授权当前目标、Goal、轮次及修订，在所设次数/有效期/时段内自动发送</label>
   <article v-for="item in tasks" :key="item.id" class="panel"><p class="mono">{{item.threadRef.threadId}}</p><p>修订 {{item.revision}} · {{item.enabled?'已启用':'已暂停'}} · {{item.mode==='observe'?'仅观察':'自动'}} · {{phaseLabels[item.phase]||item.phase}} · {{item.resumeCount}} / {{item.maxResumes}}</p>
    <ElButton :disabled="busy" @click="edit(item)">读取提示词与编辑</ElButton><template v-if="!archived"><ElButton :disabled="busy" @click="action(item.enabled?'tasks.pause':'tasks.enable',item)">{{item.enabled?'暂停任务':'启用任务'}}</ElButton><ElButton :disabled="busy||item.enabled" @click="action('tasks.remove',item)">移入归档</ElButton></template>
    <ElButton @click="inspect('tasks.revisions.list',item)">修订记录</ElButton><ElButton @click="inspect('timelines.get',item)">任务时间线</ElButton>
    <template v-if="!archived"><ElButton @click="inspect('tasks.inspect',item)">只读任务诊断</ElButton><ElButton @click="action('tasks.reconcile',item)">仅核对原任务投递</ElButton></template>
   </article><p v-if="!tasks.length">当前列表没有任务。</p><pre v-if="details">{{details}}</pre>
  </section>
  <section class="panel"><h2>提示词模板</h2><p class="muted">创建任务时复制正文；模板及默认项变化不会追改既有任务。</p>
   <label>模板名称<input v-model="templateName" aria-label="模板名称" maxlength="80" /></label><label>模板正文<textarea v-model="templateBody" aria-label="模板正文" rows="3" maxlength="10000"></textarea></label><ElButton :disabled="busy" @click="templateSave">{{editingTemplate?'保存模板修订':'创建模板'}}</ElButton><ElButton @click="editingTemplate=null;templateName='';templateBody=''">新建模板表单</ElButton>
   <article v-for="item in templates" :key="item.id"><strong>{{item.name}}</strong> · 修订 {{item.revision}} {{item.isDefault?'· 默认':''}} <ElButton @click="templateEdit(item)">读取并编辑模板</ElButton><ElButton @click="copyTemplate(item)">复制模板</ElButton><ElButton @click="templateAction('templates.setDefault',item)">设为默认</ElButton><ElButton @click="templateAction('templates.delete',item)">删除模板</ElButton></article>
  </section>
 </section>
</template>
