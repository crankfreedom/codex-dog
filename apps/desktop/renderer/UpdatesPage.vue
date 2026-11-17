<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElButton } from 'element-plus';
import { useDesktop } from './store.ts';

interface UpdateCandidate { id: string; version: string; fileName: string; sha512: string; size: number }
interface UpdateOperation { id: string; kind: 'download' | 'install'; state: string; version: string; at: number; error: string | null }
interface UpdateStatus {
  supported: boolean; channel: string; repository: string; currentVersion: string; phase: string;
  candidate: UpdateCandidate | null; artifact: { id: string; version: string } | null;
  operations: UpdateOperation[]; error: string | null; unsignedTestDistribution: boolean;
  backend: { provider: string; downloadedBytes: number } | null;
  configuration:{revision:number;automaticCheck:boolean;intervalSeconds:number;automaticDownload:false};
}
const store = useDesktop();
const status = ref<UpdateStatus | null>(null);
const busy = ref(false), error = ref(''), message = ref('');
const installTarget = ref<{ id: string; version: string } | null>(null), installConfirmed = ref(false);
const configurationRevision=ref<number|null>(null),automaticCheck=ref(false),checkInterval=ref(3600);
let active = true, reading = false, timer: ReturnType<typeof setTimeout> | undefined;
const phases: Record<string, string> = { idle: '尚未发现新版本', available: '有可下载版本', downloading: '正在下载', ready: '安装包已准备好', installing: '正在进行安装前检查', awaiting_restart: '等待重启后核对', failed: '操作失败' };
const states: Record<string, string> = { accepted: '请求已接受', running: '进行中', awaiting_restart: '等待重启核对', succeeded: '已核对完成', failed: '失败' };
const updateInProgress = computed(() => ['downloading', 'installing', 'awaiting_restart'].includes(status.value?.phase ?? ''));
const downloadedBytes = computed(() => Math.max(0, status.value?.backend?.downloadedBytes ?? 0));
const progress = computed(() => {
  const size = status.value?.candidate?.size;
  return size && size > 0 ? Math.min(100, Math.round(downloadedBytes.value / size * 1000) / 10) : null;
});
function bytes(value: number) { return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(value / 1024 / 1024) + ' MB'; }
function time(value: number) { return Number.isFinite(value) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未知'; }
function apply(data: Record<string, unknown>) {
  status.value = data as unknown as UpdateStatus;
  if(configurationRevision.value===null&&status.value.configuration){configurationRevision.value=status.value.configuration.revision;automaticCheck.value=status.value.configuration.automaticCheck;checkInterval.value=status.value.configuration.intervalSeconds;}
  if (installTarget.value && (status.value.artifact?.id !== installTarget.value.id || status.value.artifact.version !== installTarget.value.version)) {
    installTarget.value = null; installConfirmed.value = false;
  }
}
async function read() {
  if (reading) return;
  reading = true;
  try { const data = await store.request('updates.status'); if (active) { apply(data); error.value = ''; } }
  catch (cause) { if (active) { status.value = null; error.value = (cause as Error).message; installTarget.value = null; installConfirmed.value = false; } }
  finally { reading = false; }
}
async function poll() { await read(); if (active) timer = setTimeout(() => { void poll(); }, 1000); }
async function action(work: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true; error.value = ''; message.value = '';
  try { await work(); } catch (cause) { error.value = (cause as Error).message; }
  finally { busy.value = false; }
}
async function check() {
  await action(async () => {
    apply(await store.request('updates.check'));
    message.value = status.value?.candidate ? '已找到当前通道的兼容版本；下载和安装分别操作。' : '本次检查未发现当前通道的兼容新版本。';
  });
}
async function download() {
  const candidate = status.value?.candidate;
  if (!candidate) return;
  await action(async () => {
    const result = await store.request('updates.download', { candidateId: candidate.id, expectedVersion: candidate.version }, crypto.randomUUID());
    message.value = `版本 ${candidate.version} 的下载请求已接受，操作 ${String(result.operationId)}。请以下方持久状态为准。`;
    await read();
  });
}
function openInstall() {
  const artifact = status.value?.artifact;
  if (!artifact) return;
  installTarget.value = { ...artifact }; installConfirmed.value = false;
}
async function install() {
  const target = installTarget.value;
  if (!target || !installConfirmed.value) return;
  await action(async () => {
    const current = await store.request('updates.status') as unknown as UpdateStatus;
    apply(current as unknown as Record<string, unknown>);
    if (!current.supported || current.artifact?.id !== target.id || current.artifact.version !== target.version) throw new Error('安装目标已变化，请重新读取并确认目标版本。');
    const result = await store.request('updates.install', { artifactId: target.id, expectedVersion: target.version, confirm: true }, crypto.randomUUID());
    installTarget.value = null; installConfirmed.value = false;
    message.value = `版本 ${target.version} 的安装请求已接受，操作 ${String(result.operationId)}。应用可能退出；须在重启后核对实际版本和操作结果。`;
  });
}
async function savePolicy(){await action(async()=>{if(!status.value||configurationRevision.value===null)throw new Error('更新策略尚未读取');await store.request('updates.configure',{expectedRevision:configurationRevision.value,channel:status.value.channel,automaticCheck:automaticCheck.value,intervalSeconds:checkInterval.value,automaticDownload:false},crypto.randomUUID());configurationRevision.value=null;await read();message.value='更新检查策略已保存；下载和安装仍须分别确认。';});}
onMounted(() => { void poll(); });
onBeforeUnmount(() => { active = false; clearTimeout(timer); });
</script>

<template>
  <section class="panel" aria-label="应用更新">
    <div class="section-heading"><h2>应用更新</h2><ElButton :disabled="busy" @click="read">只读刷新更新状态</ElButton></div>
    <p v-if="!status" class="notice" role="status">更新状态未知。请确认应用服务可用后重新读取。</p>
    <template v-else>
      <p id="update-support" role="status">{{ status.supported ? '当前安装支持此通道的更新' : '当前安装不支持在线更新' }}</p>
      <p v-if="!status.supported" class="muted">开发版或隔离 Preview 可能不接官方更新。请使用已审阅的安装包；此页不会自动安装或发布版本。</p>
      <dl class="detail-grid">
        <dt>当前版本</dt><dd id="update-current-version">{{ status.currentVersion }}</dd>
        <dt>固定通道</dt><dd>{{ status.channel === 'stable' ? 'Stable' : status.channel === 'beta' ? 'Beta' : status.channel }}</dd>
        <dt>更新仓库</dt><dd class="mono">{{ status.repository }}</dd>
        <dt>更新状态</dt><dd id="update-phase">{{ phases[status.phase] || status.phase }}</dd>
        <dt>发行类型</dt><dd>{{ status.unsignedTestDistribution ? '未签名测试发行' : '须通过可信签名门禁的发行' }}</dd>
      </dl>
      <ElButton type="primary" :disabled="busy || !status.supported || updateInProgress" @click="check">检查当前通道更新</ElButton>
      <p v-if="status.error" role="alert" class="notice">更新服务：{{ status.error }}</p>
    </template>
    <p v-if="error" role="alert" class="notice">{{ error }}</p><p v-if="message" role="status">{{ message }}</p>
  </section>

  <section v-if="status?.candidate" class="panel" aria-label="固定更新候选">
    <h2>候选版本 {{ status.candidate.version }}</h2>
    <p class="muted">下载绑定本次候选的版本、大小和校验值。发现其他版本不会替换已接受的下载目标。</p>
    <dl class="detail-grid"><dt>文件</dt><dd class="mono">{{ status.candidate.fileName }}</dd><dt>大小</dt><dd>{{ bytes(status.candidate.size) }}</dd></dl>
    <template v-if="status.phase === 'downloading'">
      <p role="status">已下载 {{ bytes(downloadedBytes) }} / {{ bytes(status.candidate.size) }}{{ progress === null ? '' : ` · ${progress}%` }}</p>
      <progress :value="progress ?? undefined" max="100" aria-label="更新下载进度"></progress>
    </template>
    <div class="actions"><ElButton :disabled="busy || !status.supported || updateInProgress || !!status.artifact" @click="download">下载版本 {{ status.candidate.version }}</ElButton><ElButton v-if="status.artifact" type="primary" :disabled="busy || !status.supported || updateInProgress" @click="openInstall">审阅安装版本 {{ status.artifact.version }}</ElButton></div>
  </section>

  <section v-if="status" class="panel" aria-label="更新操作记录">
    <h2>持久操作记录</h2><p class="muted">请求已接受与安装完成分别记录。断连不能证明安装成功，重启后的版本核对才会完成安装操作。</p>
    <div class="table-scroll"><table v-if="status.operations.length"><thead><tr><th>操作 / 目标版本</th><th>状态</th><th>时间与结果</th></tr></thead><tbody><tr v-for="operation in [...status.operations].reverse()" :key="operation.id"><td>{{ operation.kind === 'download' ? '下载' : '安装' }} · {{ operation.version }}<small class="mono">{{ operation.id }}</small></td><td>{{ states[operation.state] || operation.state }}</td><td>{{ time(operation.at) }}<small>{{ operation.error || '—' }}</small></td></tr></tbody></table><p v-else class="muted">暂无更新操作。</p></div>
  </section>
  <section v-if="status" class="panel"><h2>更新检查策略</h2><p class="muted">只检查固定发行通道。Preview 会保留设置，但不连接官方更新；下载和安装逐次确认。</p><label><input v-model="automaticCheck" type="checkbox" aria-label="自动只读检查更新" />自动只读检查更新</label><label>检查间隔（秒）<input v-model.number="checkInterval" type="number" min="300" max="86400" aria-label="更新检查间隔" /></label><ElButton :disabled="busy||configurationRevision===null" @click="savePolicy">保存更新检查策略</ElButton><ElButton :disabled="busy" @click="configurationRevision=null;read()">重新读取更新策略</ElButton></section>

  <div v-if="installTarget" class="modal-backdrop"><section class="panel modal" role="dialog" aria-modal="true" aria-label="确认安装更新"><h2>安装版本 {{ installTarget.version }}？</h2><p>安装前会检查文件占用、保存一致备份并停止本实例。应用将退出；已提交或未决的业务操作须在重启后核对。</p><label class="checkbox"><input v-model="installConfirmed" type="checkbox" aria-label="明确确认安装所示版本" />我明确确认关闭应用并安装版本 {{ installTarget.version }}</label><p v-if="error" role="alert" class="notice">{{ error }}</p><div class="actions"><ElButton :disabled="busy" @click="installTarget = null; installConfirmed = false">返回</ElButton><ElButton type="primary" :disabled="busy || !installConfirmed" @click="install">确认安装版本 {{ installTarget.version }}</ElButton></div></section></div>
</template>
