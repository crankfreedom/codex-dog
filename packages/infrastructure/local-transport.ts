import { connect, type Socket } from 'node:net';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { readFile, mkdir, open, link, unlink, stat } from 'node:fs/promises';
import { z } from 'zod';
import { credentialSchema, definitions, failure, responseSchema } from '../contracts/protocol.ts';
import type { Credential, Request, Response } from '../contracts/protocol.ts';
import { seal, unseal } from './channel.ts';

export const requestLimit = 1024 * 1024;
export const responseLimit = 4 * 1024 * 1024;
export function locations(profile = 'g02') {
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(profile)) throw new Error('profile 无效');
  const user = createHash('sha256').update(userInfo().username + homedir()).digest('hex').slice(0, 16);
  const directory = join(process.env.LOCALAPPDATA ?? join(homedir(), '.local/share'), 'codex-dog', 'profiles', profile);
  return { directory, descriptor: join(directory, 'endpoint.json'), pipe: process.platform === 'win32' ? `\\\\.\\pipe\\codex-dog-g02-${user}-${profile}` : join(directory, 'app.sock') };
}
export const endpointSchema = z.object({ apiVersion: z.literal('3'), pipe: z.string(), appPid: z.number().int().positive(), instanceId: z.string().uuid(), brokerPid: z.number().int().positive(), ownerSid: z.string(), transportKey: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export async function localCredential(profile: string, clientName: string, create: boolean): Promise<Credential | undefined> {
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(clientName)) throw new Error('INVALID_ARGUMENT');
  const directory = join(locations(profile).directory, 'clients'); const path = join(directory, clientName + '.json');
  const read = async () => { if ((await stat(path)).size > 4096) throw new Error('INVALID_ARGUMENT'); return credentialSchema.parse(JSON.parse(await readFile(path, 'utf8'))); };
  try { return await read(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (!create) return undefined;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const credential = { clientId: randomUUID(), secret: randomBytes(32).toString('hex') };
  const temporary = path + '.' + randomUUID() + '.tmp'; const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(credential)); await file.sync(); } finally { await file.close(); }
  try { await link(temporary, path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  finally { await unlink(temporary).catch(() => {}); }
  return read();
}
export function frame(value: unknown, limit = responseLimit): Buffer {
  const payload = Buffer.from(JSON.stringify(value), 'utf8');
  if (payload.length > limit) throw new Error('INPUT_TOO_LARGE');
  const header = Buffer.alloc(4); header.writeUInt32LE(payload.length);
  return Buffer.concat([header, payload]);
}
export function readFrame(socket: Socket, limit: number, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => finish(new Error('READ_TIMEOUT')), timeoutMs);
    const cleanup = () => { clearTimeout(timer); socket.off('data', data); socket.off('error', error); socket.off('end', end); socket.off('close', end); };
    const finish = (failure?: Error, value?: unknown) => { cleanup(); if (failure) reject(failure); else resolve(value); };
    const error = (value: Error) => finish(value);
    const end = () => finish(new Error('INCOMPLETE_FRAME'));
    const data = (chunk: Buffer) => {
      if (buffer.length + chunk.length > limit + 4) { finish(new Error('INPUT_TOO_LARGE')); return; }
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) return;
      const size = buffer.readUInt32LE(0);
      if (!size || size > limit) { finish(new Error('INPUT_TOO_LARGE')); return; }
      if (buffer.length < size + 4) return;
      if (buffer.length !== size + 4) { finish(new Error('INVALID_FRAME')); return; }
      try { finish(undefined, JSON.parse(buffer.subarray(4).toString('utf8'))); } catch { finish(new Error('INVALID_FRAME')); }
    };
    socket.on('data', data); socket.once('error', error); socket.once('end', end); socket.once('close', end);
  });
}
export async function invokeHost(request: Request, profile = 'g02', timeoutMs = 30000, clientName = 'cli'): Promise<Response> {
  let socket: Socket | undefined;
  let sent = false;
  const mutating = definitions.some(item => item.operation === request.operation && !item.readOnly);
  const started = Date.now();
  try {
    const paths = locations(profile);
    const text = await readFile(paths.descriptor, 'utf8');
    if (Buffer.byteLength(text) > 8192) return failure('APP_NOT_RUNNING', '应用端点无效，请重新启动应用', request.requestId);
    const endpoint = endpointSchema.parse(JSON.parse(text));
    if (endpoint.pipe !== paths.pipe) return failure('PERMISSION_DENIED', '端点与当前用户及 profile 不匹配', request.requestId);
    const credential = await localCredential(profile, clientName, request.operation === 'access.request');
    if (!credential && request.operation !== 'access.request') return failure('AUTH_REQUIRED', '请先运行 access request 并在桌面核对批准', request.requestId);
    const packet = seal({ credential, request: request.operation === 'access.request' ? { ...request, idempotencyKey: request.idempotencyKey ?? 'pair-' + credential!.clientId } : request }, endpoint.transportKey, endpoint.instanceId + ':client');
    const outgoing = frame(packet, requestLimit);
    socket = connect(paths.pipe);
    const pending = readFrame(socket, responseLimit, Math.max(1, timeoutMs - (Date.now() - started)));
    socket.once('connect', () => { sent = true; socket!.write(outgoing); });
    const result = responseSchema.parse(unseal(await pending, endpoint.transportKey, endpoint.instanceId + ':server:' + packet.iv));
    if (!result.ok && result.error.code === 'READ_TIMEOUT' && mutating && sent) return failure('OPERATION_UNCERTAIN', '授权操作可能已保存，请使用原幂等键核对', request.requestId);
    return result;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (mutating && sent) return failure('OPERATION_UNCERTAIN', '授权操作结果不确定，请使用原幂等键核对', request.requestId);
    if (['ENOENT', 'ECONNREFUSED', 'ENOTSOCK', 'EPIPE', 'ECONNRESET'].includes(code ?? '')) return failure('APP_NOT_RUNNING', '请先启动同一 profile 的 Codex Dog 应用', request.requestId);
    if ((error as Error).message === 'READ_TIMEOUT') return failure('READ_TIMEOUT', '只读请求超时', request.requestId);
    return failure('PROTOCOL_INCOMPATIBLE', '无法读取应用协议响应', request.requestId);
  } finally { socket?.destroy(); }
}
