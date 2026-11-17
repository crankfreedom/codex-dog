<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { ElButton } from 'element-plus';
import { useDesktop } from './store.ts';
import ClientCard from './ClientCard.vue';
import SourceSettings from './SourceSettings.vue';
import SettingsPage from './SettingsPage.vue';
import ThreadsPage from './ThreadsPage.vue';
import DiagnosticsPage from './DiagnosticsPage.vue';
import HistoryPage from './HistoryPage.vue';
import HelpPage from './HelpPage.vue';
import TasksPage from './TasksPage.vue';
import CardsPage from './CardsPage.vue';
import DeliveryPage from './DeliveryPage.vue';
import UpdatesPage from './UpdatesPage.vue';
import type { QuotaWindow } from './quota-view.ts';
const emptyWindows: QuotaWindow[] = [{ name: 'primary', usedPercent: null, remainingPercent: null }, { name: 'secondary', usedPercent: null, remainingPercent: null }];
const store = useDesktop(); const quitConfirm = ref(false); const quitError = ref('');
const titles: Record<string, string> = { quota: '额度总览',threads:'会话与 Goal',tasks:'任务与模板',cards:'重置卡预约',delivery:'调度与投递',updates:'安装与更新',diagnostics:'只读诊断',history:'本应用历史',settings:'设置与外观', clients: '客户端授权', source: '连接与来源',help:'使用说明', about: '运行状态' };
onMounted(store.start); onUnmounted(store.stop);
watch(() => store.page, () => {void store.cancelPreview();window.scrollTo({ top: 0 });});
function date(value: unknown) { const parsed = new Date(typeof value === 'number' ? value * 1000 : String(value)); return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString('zh-CN', { hour12: false }) : '未知'; }
function windowName(name: string, duration?: number | null) { return name === 'five-hour' || duration === 300 ? '5 小时额度' : name === 'weekly' || duration === 10080 ? '每周额度' : name === 'primary' ? '主要额度窗口' : name === 'secondary' ? '次要额度窗口' : name; }
async function quit() { try { await store.request('app.quit', { expectedInstanceId: store.health.instanceId, confirm: true }, crypto.randomUUID()); } catch (cause) { quitError.value = (cause as Error).message; } }
</script>
<template>
  <div class="shell">
    <aside>
      <div class="brand"><img src="icon.svg" width="38" height="38" alt="守码犬" /><div><strong>Codex Dog</strong><small>守码犬 · 任务管理</small></div></div>
      <nav aria-label="主导航"><button v-for="(title, key) in titles" :key="key" :class="{ selected: store.page === key }" :aria-current="store.page === key ? 'page' : undefined" @click="store.page = key">{{ title }}</button></nav>
      <div class="sidebar-bottom"><span class="dot" :class="store.health.state === 'running' ? 'good' : 'unknown'"></span>{{ store.health.state === 'running' ? '本机服务运行中' : '本机服务未就绪' }}<p>关闭窗口后继续驻托盘</p><button class="quit" @click="quitConfirm = true">退出并停止监控</button></div>
    </aside>
    <main>
      <header><div><p class="eyebrow">WORKSPACE / {{ store.mode === 'live-readonly' ? 'LIVE READ ONLY' : 'SIMULATION' }}</p><h1>{{ titles[store.page] }}</h1></div><span class="badge source">{{ store.mode === 'live-readonly' ? '真实只读' : store.mode === 'fixture' ? '模拟数据' : '来源未知' }}</span></header>
      <p v-if="store.statusError" role="alert" class="notice">{{ store.statusError }}</p>
      <section v-show="store.page === 'quota'">
        <div class="overview panel"><div><p class="eyebrow">当前额度状态</p><h2 id="quota-status" :class="store.presentation.tone">{{ store.presentation.label }}</h2><p class="muted">{{ store.mode === 'fixture' ? '模拟场景用于验证界面，不代表真实账号额度。' : '来自所选 Codex 桌面；观察有效期 30 秒。' }}</p></div><ElButton id="read-quota" type="primary" :loading="store.busy" @click="store.readQuota(true)">{{ store.mode === 'live-readonly' ? '刷新真实额度' : '读取模拟额度' }}</ElButton></div>
        <p id="state" role="status" class="muted">{{ store.error || (store.quota ? `读取成功 · source=${store.quota.source}` : '正在读取…') }}</p>
        <div class="quota-grid"><article v-for="(item, index) in store.quota?.windows || emptyWindows" :key="item.name" class="panel quota-card">
          <div class="card-top"><h3>{{ windowName(item.name, item.windowDurationMins) }}</h3><span class="muted">0{{ index + 1 }}</span></div>
          <div class="quota-number">{{ item.remainingPercent == null ? '—' : `${Math.round(item.remainingPercent * 10) / 10}%` }}<small>剩余</small></div>
          <progress :value="item.usedPercent ?? undefined" max="100" :aria-label="windowName(item.name, item.windowDurationMins) + '已用比例'"></progress>
          <p class="muted">{{ item.usedPercent == null ? '使用量未知' : `已使用 ${item.usedPercent}%` }}{{ store.presentation.stale ? ' · 已过期' : '' }}</p><p class="muted">重置时间：{{ item.resetsAt == null ? '未知' : date(item.resetsAt) }}</p>
        </article></div>
        <section class="panel facts"><div><span>来源连接</span><strong>{{ store.mode === 'fixture' ? '模拟数据 · 无真实连接' : store.health.realCodexConnected ? '只读连接就绪' : '真实连接不可用' }}</strong></div><div><span>最近读取</span><strong>{{ store.quota ? date(store.quota.observedAt) : '尚无有效观察' }}</strong></div><div><span>观察状态</span><strong>{{ store.error ? '读取失败' : store.presentation.stale ? '过期 · 请刷新' : store.quota ? '有效观察' : '未知' }}</strong></div></section>
        <p v-if="store.error" class="notice" role="alert">{{ store.error }}</p><details class="diagnostics"><summary>额度诊断数据</summary><pre id="result" aria-label="额度读取结果">{{ store.result }}</pre></details>
      </section>
      <section v-show="store.page === 'clients'" aria-labelledby="access-title"><h2 id="access-title">本机客户端</h2><p class="muted">从 CLI 或 MCP 发起配对，核对名称与六位配对码后批准。管理应用权限包含来源配置、退出及更新，请按需选择。</p><p v-if="store.accessError" role="alert">{{ store.accessError }}</p><div id="clients"><ClientCard v-for="client in store.clients" :key="client.id" :client="client" /><p v-if="!store.clients.length" class="panel empty">暂无申请。请从 CLI 或 MCP 发起 access request。</p></div></section>
      <SourceSettings v-if="store.page === 'source'" />
      <TasksPage v-if="store.page==='tasks'" />
      <CardsPage v-if="store.page==='cards'" />
      <DeliveryPage v-if="store.page==='delivery'" />
      <UpdatesPage v-if="store.page==='updates'" />
      <SettingsPage v-if="store.page==='settings'" /><ThreadsPage v-if="store.page==='threads'" /><DiagnosticsPage v-if="store.page==='diagnostics'" /><HistoryPage v-if="store.page==='history'" /><HelpPage v-if="store.page==='help'" />
      <section v-show="store.page === 'about'" class="panel"><h2>本机运行状态</h2><p id="health" role="status">业务进程：{{ store.health.state || '未知' }} · 重启 {{ store.health.restartCount ?? 0 }} 次 · PID {{ store.health.workerPid ?? '无' }}</p><p class="muted">当前支持额度、连接及必要会话状态只读查询；配对授权和现有更新入口继续使用统一服务。</p><p class="muted">托盘菜单可重新打开窗口或明确退出。完全退出后 CLI/MCP 返回离线，不自动启动应用。</p><p class="mono muted">实例 {{ store.health.instanceId || '未知' }}</p></section>
      <footer>CODEX DOG <span>本机运行 · 统一任务管理</span></footer>
    </main>
    <div v-if="quitConfirm" class="modal-backdrop"><section class="panel modal" role="dialog" aria-modal="true" aria-label="确认退出"><h2>退出并停止监控？</h2><p>本机接口与业务进程将停止。CLI/MCP 会返回离线。</p><p role="alert">{{ quitError }}</p><ElButton @click="quitConfirm = false">继续运行</ElButton><ElButton type="primary" @click="quit">确认退出</ElButton></section></div>
  </div>
</template>
