import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { OperationName } from '../../../packages/contracts/protocol.ts';
import type { QuotaSnapshot } from './quota-view.ts';
import { quotaPresentation } from './quota-view.ts';
import { appearanceSchema,defaultAppearance } from '../../../packages/contracts/stage3.ts';
import { appearanceStyle } from '../../../packages/contracts/appearance-style.ts';
export interface ClientView { id: string; label: string; status: string; revision: number; scopes: string[]; requestedScopes: string[]; pairingExpiresAt: number; expiresAt: number | null }
export interface Selection {codexHome?:string;legacyLockDirectory?:string;cardExecutable?:string;allowCardConsumption?:boolean; source: 'fixture' | 'live-readonly'; callerThreadId: string; pipe: string }
export interface Configuration { active: Selection; saved: Selection; revision: number; restartRequired: boolean; override: boolean }
export const useDesktop = defineStore('desktop', () => {
  const page = ref('quota'); const health = ref<Record<string, unknown>>({}); const quota = ref<QuotaSnapshot | null>(null);
  const clients = ref<ClientView[]>([]); const config = ref<Configuration | null>(null); const error = ref(''); const accessError = ref(''); const statusError = ref(''); const busy = ref(false); const now = ref(Date.now()); const result = ref('');
  const appearance=ref({...defaultAppearance});const previewId=ref<string|null>(null);let unsubscribe:(()=>void)|undefined;
  function applyAppearance(raw:unknown){if(!raw||typeof raw!=='object')return;const value=raw as {values?:unknown;previewId?:unknown};const parsed=appearanceSchema.safeParse(value.values);if(!parsed.success)return;appearance.value=parsed.data;previewId.value=typeof value.previewId==='string'?value.previewId:null;for(const [key,text]of Object.entries(appearanceStyle(parsed.data)))document.documentElement.style.setProperty(key,text);document.documentElement.dataset.density=parsed.data.density;document.documentElement.dataset.theme=parsed.data.theme;}
  async function cancelPreview(){const id=previewId.value;if(id)try{await request('appearance.cancelPreview',{previewId:id},crypto.randomUUID());}catch{/* 隐藏或离页已撤销时不恢复过期预览。 */}}
  const mode = computed(() => String(health.value.mode ?? config.value?.active.source ?? 'unknown'));
  const presentation = computed(() => quotaPresentation(quota.value, mode.value, health.value.state === 'running' && !statusError.value, health.value.realCodexConnected === true, error.value, now.value));
  let alive = false; let timer: ReturnType<typeof setTimeout> | undefined; let clock: ReturnType<typeof setInterval> | undefined;
  async function request(operation: OperationName, params: Record<string, unknown> = {}, key?: string) {
    const value = await window.codexDog.request(operation, params, key);
    if (!value.ok) throw new Error(`${value.error.code}：${value.error.message}`);
    return value.data;
  }
  async function readQuota(refresh = false) {
    if (busy.value) return; busy.value = true;
    try {
      const value = await request(refresh && mode.value === 'live-readonly' ? 'quota.refresh' : 'quota.get');
      if (!alive) return;
      quota.value = value as unknown as QuotaSnapshot; error.value = ''; result.value = JSON.stringify(value, null, 2);
    } catch (cause) { if (alive) { error.value = (cause as Error).message; quota.value = null; result.value = ''; } }
    finally { busy.value = false; }
  }
  async function poll() {
    try { const value = await request('app.status'); if (alive) { health.value = value; statusError.value = ''; } }
    catch (cause) { if (alive) { health.value = {}; statusError.value = (cause as Error).message; } }
    await readQuota();
    try { const value = await request('access.list'); if (alive) { clients.value = value.clients as ClientView[]; accessError.value = ''; } }
    catch (cause) { if (alive) accessError.value = (cause as Error).message; }
    if (alive) { now.value = Date.now(); timer = setTimeout(() => { void poll(); }, 1000); }
  }
  async function readConfig() { config.value = await request('connections.configuration') as unknown as Configuration; }
  function start() { if (alive) return; alive = true;unsubscribe=window.codexDog.onAppearance(applyAppearance);void request('appearance.get').then(value=>applyAppearance({values:value.values,previewId:null})).catch(()=>{}); clock = setInterval(() => { now.value = Date.now(); }, 1000); void poll(); void readConfig().catch(cause => { statusError.value = (cause as Error).message; }); }
  function stop() { alive = false; clearTimeout(timer); clearInterval(clock);unsubscribe?.(); }
  return { page, health, quota, clients, config, error, accessError, statusError, busy, now, result, mode, appearance,previewId,cancelPreview,presentation, request, readQuota, readConfig, start, stop };
});
