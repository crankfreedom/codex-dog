import { open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sourceSelection } from '../contracts/protocol.ts';
import { defaultSourceState } from '../app/source-configuration.ts';
import type { SourceState, SourceStore } from '../app/source-configuration.ts';

const schema = z.object({ schemaVersion: z.literal(1), revision: z.number().int().positive(), selection: sourceSelection,
  requests: z.array(z.object({ key: z.string().max(200), body: z.string().max(4096), result: z.record(z.string(), z.unknown()) }).strict()).max(2048) }).strict();
export class FileSourceStore implements SourceStore {
  private path: string;
  constructor(path: string) { this.path = path; }
  async load(): Promise<SourceState> {
    try { const value = await readFile(this.path, 'utf8'); if (Buffer.byteLength(value) > 4 * 1024 * 1024) throw new Error(); return schema.parse(JSON.parse(value)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultSourceState(); throw new Error('来源配置损坏或版本不兼容，拒绝启动'); }
  }
  async save(value: SourceState) {
    const serialized=JSON.stringify(schema.parse(value));if(Buffer.byteLength(serialized)>4*1024*1024)throw new Error('来源配置达到存储上限');
    const path = this.path + '.' + randomUUID() + '.tmp';
    try {
      const file = await open(path, 'wx', 0o600);
      try { await file.writeFile(serialized); await file.sync(); } finally { await file.close(); }
      await rename(path, this.path);
    } catch (error) { await unlink(path).catch(() => {}); throw error; }
  }
}
