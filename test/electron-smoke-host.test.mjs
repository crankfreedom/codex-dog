import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { launchSmokeHost } from '../scripts/electron-smoke-host.mjs';

test('进程在首个窗口前退出并销毁 Playwright 对象，仍保存已缓存的退出码和脱敏事件', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dog-startup-report-')); let calls = 0; const child = { exitCode: 17, stderr: new PassThrough() };
  const desktop = { process() { if (++calls > 1) throw new Error('disposed dispatcher'); return child; }, async firstWindow() { child.stderr.write('private-fixture-token\nDOG_STARTUP stage=pipe code=PIPE_WIN32_ERROR detail=5\n'); throw new Error('closed'); }, async close() {} };
  await assert.rejects(launchSmokeHost({ env: {} }, 'unit', async () => desktop, directory), /窗口未启动/);
  const text = await readFile(join(directory, 'startup-unit.json'), 'utf8'); const report = JSON.parse(text);
  assert.equal(calls, 1); assert.equal(report.processExitCode, 17); assert.deepEqual(report.events, [{ stage: 'pipe', code: 'PIPE_WIN32_ERROR', detail: 5 }]); assert(!text.includes('private-fixture-token'));
});
