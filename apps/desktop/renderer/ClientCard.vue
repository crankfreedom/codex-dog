<script setup lang="ts">
import { ref, computed } from 'vue';
import { ElButton } from 'element-plus';
import type { ClientView } from './store.ts';
import { useDesktop } from './store.ts';
const props = defineProps<{ client: ClientView }>();
const store = useDesktop(); const code = ref(''); const admin = ref(false); const manage = ref(false);const settings=ref(false); const busy = ref(false); const message = ref('');
const expired = computed(() => props.client.status === 'pending' && props.client.pairingExpiresAt <= store.now);
const business=ref<string[]>([]);
const businessLabels:Record<string,string>={'content.read':'读取本应用提示词与模板正文','tasks.manage':'管理托管任务与模板','messages.send':'发送消息（仍需指定目标的业务授权）','cards.manage':'管理指定卡片预约','cards.consume':'消费指定卡片（仍需明确的业务授权）'};
async function act(operation: 'access.grant' | 'access.revoke') {
  busy.value = true; message.value = '';
  try {
    const item = props.client;
    await store.request(operation, { id: item.id, expectedRevision: item.revision, ...(operation === 'access.grant' ? { code: code.value.trim().toUpperCase(), scopes: ['read', ...(admin.value ? ['access.manage'] : []), ...(manage.value ? ['app.manage'] : []),...(settings.value?['settings.manage']:[]),...business.value], expiresAt: null } : {}) }, crypto.randomUUID());
    message.value = '已保存'; code.value = ''; admin.value = false; manage.value = false;settings.value=false;business.value=[];
  } catch (cause) { message.value = (cause as Error).message; }
  finally { busy.value = false; }
}
</script>
<template>
  <article class="client panel" :data-client-id="client.id">
    <div class="client-heading"><strong class="label">{{ client.label }}</strong><span class="badge">{{ expired ? '配对已过期' : client.status === 'pending' ? '等待批准' : client.status === 'granted' ? '已授权' : '已撤销' }}</span></div>
    <p class="muted mono">{{ client.id }}</p><p class="client-status">修订 {{ client.revision }} · 权限 {{ client.scopes.join(', ') || '无' }}</p>
    <template v-if="client.status === 'pending'">
      <p class="muted">{{ expired ? '请从客户端重新发起配对。' : '核对客户端名称及 CLI/MCP 显示的六位配对码。' }}</p>
      <input v-model="code" aria-label="配对码" placeholder="六位配对码" maxlength="6" autocomplete="off" :disabled="expired || busy" />
      <label v-if="client.requestedScopes.includes('access.manage')"><input v-model="admin" type="checkbox" aria-label="允许管理客户端授权" />允许管理客户端授权</label>
      <label v-if="client.requestedScopes.includes('app.manage')" class="app-permission"><input v-model="manage" type="checkbox" aria-label="允许下载和安装更新" />允许管理应用（来源配置、退出及更新）</label>
      <label v-if="client.requestedScopes.includes('settings.manage')"><input v-model="settings" type="checkbox" aria-label="允许修改本应用设置" />允许修改本应用设置和外观（不含来源、退出或更新）</label>
      <template v-for="(label,scope) in businessLabels" :key="scope"><label v-if="client.requestedScopes.includes(scope)"><input v-model="business" type="checkbox" :value="scope" :aria-label="label" />{{label}}</label></template>
      <ElButton class="grant" type="primary" :disabled="expired || busy || code.length !== 6" @click="act('access.grant')">批准读取</ElButton>
    </template>
    <ElButton v-if="client.status !== 'revoked'" class="revoke" :disabled="busy" @click="act('access.revoke')">撤销授权</ElButton><p class="action-result" role="status">{{ message }}</p>
  </article>
</template>
