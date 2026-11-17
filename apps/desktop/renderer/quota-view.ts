export interface QuotaWindow { name: string; usedPercent: number | null; remainingPercent: number | null; resetsAt?: number | null; windowDurationMins?: number | null }
export interface QuotaSnapshot { source: string; available: boolean | null; stale: boolean; observedAt: string; reason: string; windows: QuotaWindow[] }
export function quotaPresentation(snapshot: QuotaSnapshot | null, mode: string, running: boolean, connected: boolean, error: string, now: number) {
  const live = mode === 'live-readonly';
  const stale = !!snapshot && (snapshot.stale || live && (!Number.isFinite(Date.parse(snapshot.observedAt)) || now - Date.parse(snapshot.observedAt) > 30000));
  const known = !!snapshot && snapshot.windows.length === 2 && snapshot.windows.every(w => typeof w.usedPercent === 'number' && Number.isFinite(w.usedPercent) && w.usedPercent >= 0 && w.usedPercent <= 100);
  const usable = running && (!live || connected) && !error && !stale && known;
  return { stale, tone: usable && snapshot?.available === true ? 'good' : usable && snapshot?.available === false ? 'blocked' : 'unknown',
    label: !running ? '服务未就绪' : error ? '读取异常' : live && !connected ? '连接不可用' : stale ? '观察已过期' : !known || snapshot?.available == null ? '额度未知' : snapshot.available ? '额度可用' : '额度已耗尽', usable: !!usable };
}
