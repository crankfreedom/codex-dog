import { _electron } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { parseStartupDiagnostic } from '../packages/infrastructure/startup-diagnostics.ts';

export async function launchSmokeHost(options, label) {
  const events = []; let buffer = '';
  const desktop = await _electron.launch({ ...options, env: { ...options.env, CODEX_DOG_STARTUP_DIAGNOSTICS: '1' } });
  desktop.process().stderr?.on('data', data => {
    buffer = (buffer + data.toString()).slice(-8192);
    const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? '';
    for (const line of lines) { const event = parseStartupDiagnostic(line); if (event && events.length < 40) events.push(event); }
  });
  try { return { desktop, page: await desktop.firstWindow() }; }
  catch {
    const report = { result: 'startup-failed', label, processExitCode: desktop.process().exitCode, events, rawStderrRetained: false };
    await mkdir('artifacts/g06', { recursive: true });
    await writeFile(`artifacts/g06/startup-${label}.json`, JSON.stringify(report, null, 2));
    console.error(JSON.stringify(report)); await desktop.close().catch(() => {});
    throw new Error(`Electron 窗口未启动；脱敏阶段证据见 startup-${label}.json`);
  }
}
