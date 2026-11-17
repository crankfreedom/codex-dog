import { open, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AccessState, AccessStorePort } from '../modules/access/service.ts';

const scopes = z.array(z.enum(['read', 'access.manage', 'app.manage', 'settings.manage'])).max(4);
const stateSchema = z.object({ schemaVersion: z.literal(1), clients: z.array(z.object({ id: z.string().uuid(), label: z.string().max(80), secretHash: z.string().regex(/^[a-f0-9]{64}$/), requestedScopes: scopes, scopes,
  status: z.enum(['pending', 'granted', 'revoked']), revision: z.number().int().positive(), createdAt: z.number(), pairingExpiresAt: z.number(), expiresAt: z.number().nullable(), code: z.string().max(6) }).strict()).max(1000),
  requests: z.array(z.object({ key: z.string(), hash: z.string(), result: z.record(z.string(), z.unknown()), at: z.number() }).strict()).max(2048) }).strict();
export class FileAccessStore implements AccessStorePort {
  private path: string;
  constructor(path: string) { this.path = path; }
  async load(): Promise<AccessState> {
    try {
      const text = await readFile(this.path, 'utf8'); if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new Error('授权文件超限');
      return stateSchema.parse(JSON.parse(text));
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, clients: [], requests: [] }; throw new Error('授权文件无效，拒绝启动'); }
  }
  async save(state: AccessState) {
    const temporary = this.path + '.' + randomUUID() + '.tmp';
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(stateSchema.parse(state))); await file.sync(); }
    finally { await file.close(); }
    try { await rename(temporary, this.path); } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  }
}
