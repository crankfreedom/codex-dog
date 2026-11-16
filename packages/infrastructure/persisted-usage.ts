import type { UsageReadPort } from '../modules/quota/service.ts';
import type { ObservationStorePort } from '../modules/persistence/ports.ts';

export class PersistedUsageReader implements UsageReadPort {
  private store: ObservationStorePort;
  private source: UsageReadPort;
  private scenario: string;
  constructor(store: ObservationStorePort, source: UsageReadPort, scenario: string) { this.store = store; this.source = source; this.scenario = scenario; }
  async read() {
    const saved = this.store.loadObservation(this.scenario);
    if (saved) return saved;
    const observation = await this.source.read(); this.store.saveObservation(this.scenario, observation); return observation;
  }
}
