import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { UpdateError } from '../update/ports.ts';

export async function verifyWindowsSignature(script: string, file: string, publisher: string): Promise<void> {
  if (process.platform !== 'win32' || !publisher.trim()) throw new UpdateError('UPDATE_SIGNATURE_INVALID', '发行签名配置无效');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script, '-FilePath', file, '-PublisherName', publisher], { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); reject(new UpdateError('UPDATE_SIGNATURE_INVALID', '签名验证超时，拒绝安装')); }, 15000);
    child.once('error', () => { clearTimeout(timer); reject(new UpdateError('UPDATE_SIGNATURE_INVALID', '签名验证无法执行')); });
    child.once('exit', code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new UpdateError('UPDATE_SIGNATURE_INVALID', '签名、证书链、时间戳或发布者验证失败')); });
  });
}
