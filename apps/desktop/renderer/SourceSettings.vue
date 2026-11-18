<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue';
import { ElButton } from 'element-plus';
import { useDesktop } from './store.ts';
const store = useDesktop(); const form = reactive({ source: 'fixture', callerThreadId: '', pipe: '',codexHome:'',legacyLockDirectory:'',cardExecutable:'',allowCardConsumption:false }); const message = ref(''); const busy = ref(false);
onMounted(async () => { try { await store.readConfig(); Object.assign(form, store.config!.saved); } catch (cause) { message.value = (cause as Error).message; } });
async function save() {
  busy.value = true; message.value = '';
  try { await store.request('connections.configure', { ...form, expectedRevision: store.config!.revision }, crypto.randomUUID()); await store.readConfig(); message.value = '已保存。请明确退出，再启动应用以使用所选来源。'; }
  catch (cause) { message.value = (cause as Error).message; } finally { busy.value = false; }
}
</script>
<template>
  <section class="panel source-form">
    <h2>选择下次启动的来源</h2><p class="muted">当前运行：{{ store.mode === 'live-readonly' ? '真实只读' : '模拟' }}。保存后当前进程保持原来源。</p>
    <label>数据来源<select v-model="form.source" aria-label="数据来源"><option value="fixture">模拟数据</option><option value="live-readonly">真实 Codex · 只读</option></select></label>
    <template v-if="form.source === 'live-readonly'">
      <label>调用会话 ID<input v-model="form.callerThreadId" aria-label="调用会话 ID" placeholder="明确指定的 Codex 会话 UUID" /></label>
      <label>本机工具管道<input v-model="form.pipe" aria-label="本机工具管道" placeholder="留空仅在候选唯一时选择" /></label>
      <label>目标元数据目录（可选）<input v-model="form.codexHome" aria-label="目标元数据目录" placeholder="明确指定 Codex home；留空沿用启动环境" /></label>
      <label>旧版共享锁目录（可选）<input v-model="form.legacyLockDirectory" aria-label="旧版共享锁目录" placeholder="绝对路径；仅检查，不创建或回收锁" /></label>
      <p class="muted">目录选择只提供只读检查位置；账号执行绑定、原发送回执和旧版崩溃恢复仍须独立核验。</p>
      <label>卡片明细来源（可选）<input v-model="form.cardExecutable" aria-label="卡片来源 Codex CLI" placeholder="明确指定本机 codex.exe 绝对路径；留空不读取卡片" /></label>
      <label><input v-model="form.allowCardConsumption" type="checkbox" aria-label="允许真实指定卡消费来源" />允许此来源用于真实指定卡消费（每笔仍需指定卡、时间和消费授权）</label>
      <p class="muted">多个实例时请填写明确管道。断连后不会改选其他实例。额度与连接状态来自当前桌面，只读查询不推进任务。</p>
    </template>
    <p v-if="store.config?.override" class="notice">本次存在启动参数覆盖。下次启动请移除相应参数以使用已保存配置。</p><p v-if="store.config?.restartRequired" class="notice">已保存配置与当前运行不同，下次启动生效。</p>
    <ElButton type="primary" :disabled="busy || !store.config" @click="save">保存来源选择</ElButton><p role="status">{{ message }}</p>
  </section>
</template>
