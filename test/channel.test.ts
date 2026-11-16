import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { seal, unseal } from '../packages/infrastructure/channel.ts';

test('通道不发送明文凭据，篡改及不同实例/方向均失败关闭', () => {
  const key = randomBytes(32).toString('hex'); const secret = randomBytes(32).toString('hex');
  const value = { credential: { secret }, request: { operation: 'quota.get' } };
  const packet = seal(value, key, 'instance:client');
  assert(!JSON.stringify(packet).includes(secret)); assert.deepEqual(unseal(packet, key, 'instance:client'), value);
  assert.throws(() => unseal(packet, key, 'other-instance:client'));
  assert.throws(() => unseal(packet, key, 'instance:server'));
  const tampered = { ...packet, tag: (packet.tag[0] === '0' ? '1' : '0') + packet.tag.slice(1) };
  assert.throws(() => unseal(tampered, key, 'instance:client'));
});
test('响应绑定本次请求 nonce，不能把旧响应或请求反射成成功结果', () => {
  const key = randomBytes(32).toString('hex'); const request = seal({}, key, 'instance:client');
  const response = seal({ ok: true }, key, 'instance:server:' + request.iv);
  assert.deepEqual(unseal(response, key, 'instance:server:' + request.iv), { ok: true });
  assert.throws(() => unseal(response, key, 'instance:server:' + '0'.repeat(24)));
  assert.throws(() => unseal(request, key, 'instance:server:' + request.iv));
});
