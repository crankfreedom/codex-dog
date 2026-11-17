const stages = ['bootstrap', 'pipe', 'access', 'worker', 'update', 'window'] as const;
const codes = ['BEGIN', 'READY', 'STARTUP_FAILED', 'PIPE_HOST_TIMEOUT', 'PIPE_HOST_SPAWN_FAILED', 'PIPE_HOST_EARLY_EXIT', 'PIPE_HOST_INIT_FAILED', 'PIPE_WIN32_ERROR', 'PIPE_ACCESS_DENIED', 'PIPE_SECURITY_ERROR', 'PIPE_IO_ERROR'] as const;
export interface StartupDiagnostic { stage: string; code: string; detail: number | null }
export function startupDiagnostic(stage: string, code: unknown, detail?: unknown): StartupDiagnostic {
  return { stage: (stages as readonly string[]).includes(stage) ? stage : 'bootstrap', code: typeof code === 'string' && (codes as readonly string[]).includes(code) ? code : 'STARTUP_FAILED', detail: typeof detail === 'number' && Number.isSafeInteger(detail) ? detail : null };
}
export function formatStartupDiagnostic(stage: string, code: unknown, detail?: unknown) {
  const event = startupDiagnostic(stage, code, detail);
  return `DOG_STARTUP stage=${event.stage} code=${event.code} detail=${event.detail ?? 'none'}`;
}
export function parseStartupDiagnostic(line: string): StartupDiagnostic | null {
  const match = /^DOG_STARTUP stage=([a-z]+) code=([A-Z0-9_]+) detail=(none|-?\d+)$/.exec(line);
  if (!match) return null;
  const event = startupDiagnostic(match[1]!, match[2], match[3] === 'none' ? null : Number(match[3]));
  return event.stage === match[1] && event.code === match[2] ? event : null;
}
