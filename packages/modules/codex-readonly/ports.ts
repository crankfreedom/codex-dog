export const readToolNames = ['get_usage_limits', 'list_threads', 'read_thread'] as const;
export type ReadTool = typeof readToolNames[number];
export interface CodexReadPort {
  start(): Promise<void>;
  read(tool: ReadTool, params: Record<string, unknown>): Promise<unknown>;
  discover(): { candidates: Array<{ candidateId: string; selected: boolean }>; selectionRequired: boolean };
  connected(): boolean;
  audit?(): Record<string, number>;
  close(): void;
}
export interface GoalState { availability: 'known' | 'unknown'; current: { id: string; status: string } | null; reason: string | null }
export interface GoalReadPort { read(threadId: string): GoalState }
export class ReadError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
export interface ReadonlyOptions {
  newId(): string;
  digest(value: string): string;
  now(): number;
}
