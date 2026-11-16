import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileAccessStore } from '../packages/infrastructure/access-store.ts';
import type { AccessState } from '../packages/modules/access/service.ts';

test('授权存储不存在时为空，提交后完整恢复且不留下临时文件', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-dog-access-store-'));
  const store = new FileAccessStore(join(directory, 'access.json'));
  assert.deepEqual(await readdir(directory), []);
  const state: AccessState = { schemaVersion: 1, clients: [], requests: [] };
  assert.deepEqual(await store.load(), state);
  await store.save(state);
  assert.deepEqual(await store.load(), state);
  assert.deepEqual(await readdir(directory), ['access.json']);
});
test('损坏或未来版本授权文件失败关闭，绝不覆盖成空授权', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-dog-access-store-'));
  const path = join(directory, 'access.json'); const store = new FileAccessStore(path);
  for (const source of ['{broken', JSON.stringify({ schemaVersion: 99, clients: [], requests: [] })]) {
    await writeFile(path, source); await assert.rejects(store.load(), /拒绝启动/);
    assert.equal(await readFile(path, 'utf8'), source);
  }
});
