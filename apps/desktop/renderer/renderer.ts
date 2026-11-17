import type { OperationName, Response } from '../../../packages/contracts/protocol.ts';
declare global { interface Window { codexDog: { request(operation: OperationName, params?: Record<string, unknown>, idempotencyKey?: string): Promise<Response> } } }
const button = document.getElementById('read-quota') as HTMLButtonElement;
const state = document.getElementById('state')!;
const output = document.getElementById('result')!;
const health = document.getElementById('health')!;
const clients = document.getElementById('clients')!;
interface Client { id: string; label: string; status: string; revision: number; requestedScopes: string[]; scopes: string[]; pairingExpiresAt: number }
const current = new Map<string, Client>();
const cards = new Map<string, HTMLElement>();
async function refreshQuota() {
  button.disabled = true;
  try {
    const result = await window.codexDog.request('quota.get');
    state.textContent = result.ok ? `IPC 读取成功 · source=${result.meta.source}` : `${result.error.code}：${result.error.message}`;
    output.textContent = JSON.stringify(result, null, 2);
  } catch { state.textContent = 'IPC 暂不可用。'; }
  finally { button.disabled = false; }
}
function card(record: Client) {
  const element = document.createElement('div'); element.className = 'client'; element.dataset.clientId = record.id;
  const label = document.createElement('p'); label.className = 'label';
  const status = document.createElement('p'); status.className = 'client-status';
  const code = document.createElement('input'); code.placeholder = '六位配对码'; code.maxLength = 6; code.setAttribute('aria-label', '配对码');
  const adminLabel = document.createElement('label');
  const admin = document.createElement('input'); admin.type = 'checkbox'; admin.setAttribute('aria-label', '允许管理客户端授权');
  adminLabel.append(admin, document.createTextNode('允许管理客户端授权'));
  const appLabel = document.createElement('label'); appLabel.className = 'app-permission';
  const appManage = document.createElement('input'); appManage.type = 'checkbox'; appManage.setAttribute('aria-label', '允许下载和安装更新');
  appLabel.append(appManage, document.createTextNode('允许下载和安装更新'));
  const grant = document.createElement('button'); grant.textContent = '批准读取'; grant.className = 'grant';
  const revoke = document.createElement('button'); revoke.textContent = '撤销授权'; revoke.className = 'revoke';
  const message = document.createElement('p'); message.className = 'action-result'; message.setAttribute('role', 'status');
  async function act(operation: 'access.grant' | 'access.revoke') {
    grant.disabled = true; revoke.disabled = true;
    try {
      const record = current.get(element.dataset.clientId!)!;
      const params = operation === 'access.grant' ? { id: record.id, expectedRevision: record.revision, code: code.value.trim().toUpperCase(), scopes: ['read', ...(admin.checked ? ['access.manage'] : []), ...(appManage.checked ? ['app.manage'] : [])], expiresAt: null } : { id: record.id, expectedRevision: record.revision };
      const result = await window.codexDog.request(operation, params, crypto.randomUUID());
      message.textContent = result.ok ? '已保存' : `${result.error.code}：${result.error.message}`;
      await refreshClients();
    } finally { grant.disabled = false; revoke.disabled = false; }
  }
  grant.addEventListener('click', () => void act('access.grant'));
  revoke.addEventListener('click', () => void act('access.revoke'));
  element.append(label, status, code, adminLabel, appLabel, grant, revoke, message);
  return element;
}
async function refreshClients() {
  const result = await window.codexDog.request('access.list'); if (!result.ok) return;
  const records = result.data.clients as Client[];
  for (const record of records) {
    current.set(record.id, record);
    let element = cards.get(record.id); if (!element) { element = card(record); cards.set(record.id, element); clients.append(element); }
    element.querySelector('.label')!.textContent = `${record.label} · ${record.id}`;
    element.querySelector('.client-status')!.textContent = `${record.status} · 修订 ${record.revision} · 权限 ${record.scopes.join(', ') || '无'}`;
    (element.querySelector('.grant') as HTMLElement).hidden = record.status !== 'pending';
    (element.querySelector('input[aria-label="配对码"]') as HTMLElement).hidden = record.status !== 'pending';
    (element.querySelector('label') as HTMLElement).hidden = record.status !== 'pending' || !record.requestedScopes.includes('access.manage');
    (element.querySelector('.app-permission') as HTMLElement).hidden = record.status !== 'pending' || !record.requestedScopes.includes('app.manage');
    (element.querySelector('.revoke') as HTMLElement).hidden = record.status === 'revoked';
  }
  if (!records.length) clients.textContent = '暂无申请。请从 CLI 或 MCP 发起 access request。';
  else if (clients.firstChild?.nodeType === Node.TEXT_NODE) clients.firstChild.remove();
}
async function poll() {
  try {
    const result = await window.codexDog.request('app.status');
    health.textContent = result.ok ? `业务进程：${result.data.state} · 重启 ${result.data.restartCount} 次 · PID ${result.data.workerPid ?? '无'}` : result.error.code;
    await refreshClients();
  } catch { health.textContent = '应用正在退出或暂不可用'; }
}
button.addEventListener('click', () => void refreshQuota());
void refreshQuota(); void poll(); setInterval(() => void poll(), 1000);
