import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import type { Response } from '../contracts/protocol.ts';
import { failure } from '../contracts/protocol.ts';

export interface PipeIdentity { pid: number; ownerSid: string; pipeSddl: string; rootProtected: boolean }
export class SecurePipeHost {
  private child?: ChildProcessWithoutNullStreams;
  private stopped = false;
  private options: { script: string; pipe: string; directory: string; request: (raw: unknown, peerSid: string) => Promise<unknown>; failed: () => void };
  constructor(options: SecurePipeHost['options']) { this.options = options; }
  processId() { return this.child?.pid; }
  async start(): Promise<PipeIdentity> {
    if (process.platform !== 'win32') throw new Error('G02 本机身份适配目前仅支持 Windows');
    const child = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', this.options.script, '-PipeName', this.options.pipe.split('\\').at(-1)!, '-Directory', this.options.directory],
      { windowsHide: true, stdio: 'pipe' });
    this.child = child;
    child.stdin.on('error', () => { if (!this.stopped) child.kill(); });
    const lines = createInterface({ input: child.stdout });
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => { child.kill(); reject(new Error('安全管道启动超时')); }, 15000);
      child.stderr.on('data', () => { /* 不向日志转储可能包含敏感请求的宿主错误。 */ });
      child.once('error', () => { clearTimeout(timer); reject(new Error('Windows 安全管道宿主启动失败')); });
      child.once('exit', () => { clearTimeout(timer); lines.close(); if (!settled) reject(new Error('安全管道宿主提前退出')); else if (!this.stopped) this.options.failed(); });
      lines.on('line', line => {
        if (line.length > 5 * 1024 * 1024) { child.kill(); return; }
        try {
          const message = JSON.parse(line);
          if (message.type === 'ready') { settled = true; clearTimeout(timer); resolve(message as PipeIdentity); }
          else if (message.type === 'request' && typeof message.id === 'string' && typeof message.peerSid === 'string') {
            const id = message.id;
            const respond = (result: unknown) => {
              if (!this.stopped && child.stdin.writable) child.stdin.write(JSON.stringify({ type: 'response', id, body: JSON.stringify(result) }) + '\n');
            };
            let body: unknown;
            try { body = JSON.parse(message.body); } catch { respond(failure('INVALID_ARGUMENT', '本机请求 JSON 无效')); return; }
            void this.options.request(body, message.peerSid).then(respond).catch(() => respond(failure('INTERNAL_ERROR', '本机请求处理失败')));
          } else if (message.type === 'fatal') child.kill();
        } catch { child.kill(); }
      });
    });
  }
  async stop() {
    this.stopped = true;
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.stdin.end(JSON.stringify({ type: 'stop' }) + '\n');
    });
  }
}
