import { _electron } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { parseStartupDiagnostic } from '../packages/infrastructure/startup-diagnostics.ts';

export async function launchSmokeHost(options, label, launch = options => _electron.launch(options), reportDirectory = 'artifacts/g06') {
  const events = []; let buffer = '';
  const desktop = await launch({ ...options, env: { ...options.env, CODEX_DOG_STARTUP_DIAGNOSTICS: '1' } });
  const child = desktop.process();
  child.stderr?.on('data', data => {
    buffer = (buffer + data.toString()).slice(-8192);
    const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? '';
    for (const line of lines) { const event = parseStartupDiagnostic(line); if (event && events.length < 40) events.push(event); }
  });
  try { return { desktop, page: await desktop.firstWindow() }; }
  catch {
    await new Promise(resolve => setTimeout(resolve, 100));
    const report = { result: 'startup-failed', label, processExitCode: child.exitCode, events, rawStderrRetained: false };
    await mkdir(reportDirectory, { recursive: true });
    await writeFile(`${reportDirectory}/startup-${label}.json`, JSON.stringify(report, null, 2));
    console.error(JSON.stringify(report)); await desktop.close().catch(() => {});
    throw new Error(`Electron 窗口未启动；脱敏阶段证据见 startup-${label}.json`);
  }
}
