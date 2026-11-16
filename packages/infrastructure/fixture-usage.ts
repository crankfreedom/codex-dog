import type { UsageObservation, UsageReadPort } from '../modules/quota/service.ts';

export class FixtureUsageReader implements UsageReadPort {
  private scenario: 'available' | 'blocked' | 'unknown';
  private now: () => Date;
  reads = 0;
  constructor(scenario: 'available' | 'blocked' | 'unknown', now = () => new Date()) { this.scenario = scenario; this.now = now; }
  async read(): Promise<UsageObservation> {
    this.reads += 1;
    return { source: 'fixture', observedAt: this.now().toISOString(), windows: [
      { name: 'five-hour', usedPercent: this.scenario === 'available' ? 25 : this.scenario === 'blocked' ? 100 : null },
      { name: 'weekly', usedPercent: 40 },
    ] };
  }
}
