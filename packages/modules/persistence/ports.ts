import type { UsageObservation } from '../quota/service.ts';

export interface ObservationStorePort {
  loadObservation(scenario: string): UsageObservation | undefined;
  saveObservation(scenario: string, observation: UsageObservation): void;
}
export interface FixtureIntentInput {
  taskId: string; expectedRevision: number; attemptId: string; clientId: string; key: string;
}
export interface FixtureTask { id: string; target: string; revision: number; count: number; maxCount: number }
export interface PersistenceHealth { schemaVersion: number; journalMode: string; sqliteVersion: string; integrity: string }
export class PersistenceError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
