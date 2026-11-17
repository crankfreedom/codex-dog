<script setup lang="ts">
import { reactive,ref,onMounted,onBeforeUnmount } from 'vue';
import { ElButton } from 'element-plus';
import { defaultAppearance,defaultMonitoring } from '../../../packages/contracts/stage3.ts';
import type { Appearance } from '../../../packages/contracts/stage3.ts';
import { useDesktop } from './store.ts';
const store=useDesktop(),form=reactive({...defaultAppearance}),monitoring=reactive({...defaultMonitoring});
const revision=ref(0),monitorRevision=ref(0),message=ref(''),busy=ref(false),themes=ref<Array<{id:Appearance['theme'];label:string}>>([]),presets=ref<Array<{id:string;label:string;values:Appearance}>>([]);
const sizes=[{key:'titleSize' as const,label:'标题字号',min:24,max:40},{key:'sectionSize' as const,label:'分区字号',min:16,max:30},{key:'bodySize' as const,label:'正文字号',min:12,max:24},{key:'captionSize' as const,label:'辅助字号',min:11,max:18},{key:'navSize' as const,label:'导航字号',min:13,max:20}];
async function load(){busy.value=true;try{const [appearance,monitor,palette]=await Promise.all([store.request('appearance.get'),store.request('quota.policy.get'),store.request('appearance.presets')]);Object.assign(form,appearance.values);revision.value=Number(appearance.revision);Object.assign(monitoring,monitor.values);monitorRevision.value=Number(monitor.revision);themes.value=palette.themes as typeof themes.value;presets.value=palette.presets as typeof presets.value;}catch(error){message.value=(error as Error).message;}finally{busy.value=false;}}
async function act(type:'preview'|'save'|'monitor'){
  busy.value=true;message.value='';
  try{
    if(type==='monitor'){const value=await store.request('quota.policy.update',{expectedRevision:monitorRevision.value,patch:{...monitoring}},crypto.randomUUID());monitorRevision.value=Number(value.revision);message.value='已保存独立额度刷新策略，不运行任务调度。';}
    else if(type==='preview'){await store.request('appearance.preview',{expectedRevision:revision.value,patch:{...form},...(store.previewId?{previewId:store.previewId}:{})},crypto.randomUUID());message.value='正在临时预览；离页或关闭窗口将恢复已保存外观。';}
    else{const value=await store.request('appearance.update',{expectedRevision:revision.value,patch:{...form}},crypto.randomUUID());revision.value=Number(value.revision);message.value='外观已保存，重启后保留。';}
  }catch(error){message.value=(error as Error).message;}finally{busy.value=false;}
}
onMounted(load);onBeforeUnmount(()=>{void store.cancelPreview();});
</script>
<template>
  <section class="panel settings-form"><div class="section-heading"><h2>外观与阅读</h2><span class="muted">修订 {{ revision || '加载中' }}</span></div>
    <p class="muted">外观仅影响本应用。预览不会保存，离页或隐藏窗口后撤销。</p>
    <fieldset :disabled="busy||!revision"><div class="preset-row"><ElButton v-for="item in presets" :key="item.id" @click="Object.assign(form,item.values)">{{ item.label }}</ElButton></div>
    <div class="form-grid">
      <label>主题<select v-model="form.theme" aria-label="主题"><option v-for="theme in themes" :key="theme.id" :value="theme.id">{{ theme.label }}</option></select></label>
      <label>字体<select v-model="form.font" aria-label="字体"><option value="system">系统字体</option><option value="sans">无衬线</option><option value="serif">衬线阅读</option><option value="mono">等宽</option></select></label>
      <label>密度<select v-model="form.density" aria-label="密度"><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label>
      <label>对比度<select v-model="form.contrast" aria-label="对比度"><option value="standard">标准</option><option value="high">高对比</option></select></label>
      <label v-for="item in sizes" :key="item.key">{{ item.label }}<input v-model.number="form[item.key]" :aria-label="item.label" type="number" :min="item.min" :max="item.max" /></label>
      <label>行高<input v-model.number="form.lineHeight" aria-label="行高" type="number" min="1.4" max="2.2" step="0.1" /></label>
    </div></fieldset>
    <div class="actions"><ElButton :disabled="busy||!revision" @click="act('preview')">临时预览</ElButton><ElButton :disabled="busy||!store.previewId" @click="store.cancelPreview()">撤销预览</ElButton><ElButton type="primary" :disabled="busy||!revision" @click="act('save')">保存外观</ElButton><ElButton :disabled="busy" @click="load">重新读取设置</ElButton></div>
  </section>
  <section class="panel settings-form"><div class="section-heading"><h2>额度只读刷新</h2><span class="muted">修订 {{ monitorRevision || '加载中' }}</span></div><p class="muted">默认关闭。开启后只刷新当前明确选择的额度来源，不运行任务调度、发送或卡消费。</p>
    <fieldset :disabled="busy||!monitorRevision"><label class="checkbox"><input v-model="monitoring.autoRefresh" aria-label="自动只读刷新额度" type="checkbox" />自动只读刷新额度</label>
    <label>刷新间隔（秒，10–3600）<input v-model.number="monitoring.quotaIntervalSeconds" aria-label="额度刷新间隔" type="number" min="10" max="3600" /></label></fieldset><ElButton type="primary" :disabled="busy||!monitorRevision" @click="act('monitor')">保存额度策略</ElButton>
  </section><p role="status" class="notice" v-if="message">{{ message }}</p>
</template>
