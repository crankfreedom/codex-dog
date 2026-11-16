import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, connect, type Socket } from 'node:net';
import { frame, readFrame, locations } from '../packages/infrastructure/local-transport.ts';

async function sockets() {
  const server = createServer(); server.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert(address && typeof address === 'object');
  const accepted = new Promise<Socket>(resolve => server.once('connection', resolve));
  const client = connect(address.port, '127.0.0.1');
  const peer = await accepted;
  client.on('error', () => {}); peer.on('error', () => {});
  return { client, peer, async close() { client.destroy(); peer.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
test('长度帧支持拆包和中文内容', async () => {
  const pair = await sockets();
  try { const pending = readFrame(pair.peer, 1024, 1000); const bytes = frame({ text: '守码犬' });
    pair.client.write(bytes.subarray(0, 2)); pair.client.write(bytes.subarray(2, 7)); pair.client.write(bytes.subarray(7));
    assert.deepEqual(await pending, { text: '守码犬' });
  } finally { await pair.close(); }
});
test('仅头部声明超大帧就拒绝，不等待分配完整载荷', async () => {
  const pair = await sockets();
  try { const pending = readFrame(pair.peer, 100, 1000); const header = Buffer.alloc(4); header.writeUInt32LE(101); pair.client.write(header); await assert.rejects(pending, /INPUT_TOO_LARGE/); }
  finally { await pair.close(); }
});
test('读取超时和提前断开不留下永久等待', async () => {
  const pair = await sockets();
  try { await assert.rejects(readFrame(pair.peer, 100, 20), /READ_TIMEOUT/); const pending = readFrame(pair.peer, 100, 1000); pair.client.end(); await assert.rejects(pending, /INCOMPLETE_FRAME/); }
  finally { await pair.close(); }
});
test('非法 JSON 和 profile 路径拒绝', async () => {
  const pair = await sockets();
  try { const pending = readFrame(pair.peer, 100, 1000); const bytes = Buffer.alloc(5); bytes.writeUInt32LE(1); bytes[4] = 0xff; pair.client.write(bytes); await assert.rejects(pending, /INVALID_FRAME/); }
  finally { await pair.close(); }
  assert.throws(() => locations('../escape')); assert.throws(() => frame('x'.repeat(100), 10));
});
