export interface UsageWindow { name: string; usedPercent: number | null }
export interface UsageObservation { source: 'fixture'; observedAt: string; windows: UsageWindow[] }
export interface UsageReadPort { read(): Promise<UsageObservation> }
export class QuotaService {
  private port: UsageReadPort;
  private snapshot?: { available: boolean | null; reason: string; source: 'fixture'; observedAt: string; stale: boolean; windows: Array<UsageWindow & { remainingPercent: number | null }> };
  constructor(port: UsageReadPort) { this.port = port; }
  async start() {
    const observation = await this.port.read();
    if (observation.source !== 'fixture' || !Number.isFinite(Date.parse(observation.observedAt)) || observation.windows.length !== 2 || new Set(observation.windows.map(w => w.name)).size !== 2
      || !observation.windows.some(w => w.name === 'five-hour') || !observation.windows.some(w => w.name === 'weekly')
      || observation.windows.some(w => w.usedPercent !== null && (!Number.isFinite(w.usedPercent) || w.usedPercent < 0 || w.usedPercent > 100))) throw new Error('模拟额度数据无效');
    const known = observation.windows.every(w => w.usedPercent !== null);
    const available = known ? observation.windows.every(w => w.usedPercent! < 100) : null;
    this.snapshot = { ...observation, available, reason: !known ? 'quota_unknown' : available ? 'quota_available' : 'quota_exhausted', stale: false,
      windows: observation.windows.map(w => ({ ...w, remainingPercent: w.usedPercent === null ? null : 100 - w.usedPercent })) };
  }
  get() {
    if (!this.snapshot) throw new Error('额度服务未就绪');
    return { ...this.snapshot, windows: this.snapshot.windows.map(w => ({ ...w })) };
  }
  close() { this.snapshot = undefined; }
}
