import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';

const packetSchema = z.object({ iv: z.string().regex(/^[a-f0-9]{24}$/), ciphertext: z.string().max(6 * 1024 * 1024), tag: z.string().regex(/^[a-f0-9]{32}$/) }).strict();
export type ChannelPacket = z.infer<typeof packetSchema>;
export function seal(value: unknown, key: string, binding: string): ChannelPacket {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  cipher.setAAD(Buffer.from(binding));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { iv: iv.toString('hex'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('hex') };
}
export function unseal(raw: unknown, key: string, binding: string): unknown {
  const packet = packetSchema.parse(raw);
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(packet.iv, 'hex'));
  decipher.setAAD(Buffer.from(binding)); decipher.setAuthTag(Buffer.from(packet.tag, 'hex'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(packet.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
}
export function packetIv(raw: unknown): string | undefined { const result = packetSchema.safeParse(raw); return result.success ? result.data.iv : undefined; }
