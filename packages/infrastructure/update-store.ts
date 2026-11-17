import { readFile, open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { emptyUpdateState } from '../update/ports.ts';
import type { UpdateState, UpdateStorePort } from '../update/ports.ts';
import {updateConfiguration} from '../contracts/updates.ts';

const candidate = z.object({ id: z.string(), version: z.string(), fileName: z.string(), sha512: z.string(), size: z.number().positive() }).strict();
const legacySchema = z.object({ schemaVersion: z.literal(1), phase: z.enum(['idle', 'available', 'downloading', 'ready', 'installing', 'awaiting_restart', 'failed']), candidate: candidate.nullable(), artifact: z.object({ id: z.string(), version: z.string(), path: z.string(), sha512: z.string(), size: z.number().positive() }).strict().nullable(), error: z.string().nullable(), operations: z.array(z.object({ id: z.string(), owner: z.string(), key: z.string(), digest: z.string(), kind: z.enum(['download', 'install']), state: z.enum(['accepted', 'running', 'awaiting_restart', 'succeeded', 'failed']), version: z.string(), at: z.number(), error: z.string().nullable() }).strict()).max(200) }).strict();
const currentStateSchema=legacySchema.extend({schemaVersion:z.literal(2),configuration:updateConfiguration,configurationOperations:z.array(z.object({scope:z.string().max(500),digest:z.string().max(100),result:z.record(z.string(),z.unknown())}).strict()).max(2000)});
const stateSchema=z.union([currentStateSchema,legacySchema.transform(old=>({...emptyUpdateState(),...old,schemaVersion:2 as const}))]);
export class FileUpdateStore implements UpdateStorePort {
  private path: string;
  constructor(path: string) { this.path = path; }
  async load(): Promise<UpdateState> {
    try { const text = await readFile(this.path, 'utf8'); if (text.length > 1024 * 1024) throw new Error('超限'); return stateSchema.parse(JSON.parse(text)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyUpdateState(); throw new Error('更新记录损坏或版本不兼容'); }
  }
  async save(state: UpdateState) {
    const path = this.path + '.' + randomUUID() + '.tmp'; const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(stateSchema.parse(state))); await file.sync(); } finally { await file.close(); }
    try { await rename(path, this.path); } catch (error) { await unlink(path).catch(() => {}); throw error; }
  }
}
