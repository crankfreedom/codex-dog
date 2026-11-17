import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatStartupDiagnostic, parseStartupDiagnostic } from '../packages/infrastructure/startup-diagnostics.ts';

test('启动诊断只接受固定阶段/错误码与整数，不保留错误正文或客户端秘密', () => {
  const secret = 'fixture-client-secret';
  const line = formatStartupDiagnostic('pipe', 'PIPE_WIN32_ERROR', 5);
  assert.deepEqual(parseStartupDiagnostic(line), { stage: 'pipe', code: 'PIPE_WIN32_ERROR', detail: 5 });
  assert.equal(formatStartupDiagnostic(secret, { message: secret }, secret), 'DOG_STARTUP stage=bootstrap code=STARTUP_FAILED detail=none');
  for (const input of [secret, line + ' token=' + secret, 'DOG_STARTUP stage=pipe code=' + secret + ' detail=none', 'DOG_STARTUP stage=' + secret + ' code=BEGIN detail=none']) assert.equal(parseStartupDiagnostic(input), null);
  assert(!formatStartupDiagnostic('pipe', new Error(secret)).includes(secret));
});
