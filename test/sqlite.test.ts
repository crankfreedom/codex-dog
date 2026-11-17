import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteStore } from '../packages/infrastructure/sqlite-store.ts';
import { PersistedUsageReader } from '../packages/infrastructure/persisted-usage.ts';
import { FixtureUsageReader } from '../packages/infrastructure/fixture-usage.ts';

const location = () => join(mkdtempSync(join(tmpdir(), 'codex-dog-g03-')), 'data.sqlite');
const task = { id: 'task-1', target: 'g03-fixture-target', revision: 1, count: 0, maxCount: 3 };
const intent = { taskId: task.id, expectedRevision: 1, attemptId: 'attempt-1', clientId: 'fixture', key: 'key-1' };
const unlocked = () => {};
test('SQLite 构造无副作用；显式启动启用 WAL/外键/版本及关闭后拒绝读取', () => {
  const path = location(); const store = new SqliteStore(path); assert(!existsSync(path)); store.start();
  try { assert.deepEqual({ ...store.health(), sqliteVersion: '' }, { schemaVersion: 3, journalMode: 'wal', integrity: 'ok', sqliteVersion: '' }); }
  finally { store.close(); } assert.throws(() => store.snapshot(), /尚未启动/);
});
test('模拟额度经 SQLite 持久化，重启仍读取同一快照，按场景隔离', async () => {
  const path = location(); let store = new SqliteStore(path); store.start();
  const source = new FixtureUsageReader('available'); const first = await new PersistedUsageReader(store, source, 'available').read(); assert.equal(source.reads, 1); store.close();
  store = new SqliteStore(path); store.start();
  try { const nextSource = new FixtureUsageReader('available'); assert.deepEqual(await new PersistedUsageReader(store, nextSource, 'available').read(), first); assert.equal(nextSource.reads, 0); assert.equal((await new PersistedUsageReader(store, new FixtureUsageReader('blocked'), 'blocked').read()).windows[0]!.usedPercent, 100); }
  finally { store.close(); }
});
for (const stage of ['intent:attempt', 'intent:count', 'intent:commit']) test(`事务在 ${stage} 失败时意图/槽位/计数/事件/幂等全部回滚`, () => {
  const store = new SqliteStore(location(), current => { if (current === stage) throw new Error('注入失败'); }); store.start();
  try { store.createFixtureTask(task); const before = store.snapshot(); assert.throws(() => store.prepareFixtureIntent(intent, unlocked), /注入失败/); assert.deepEqual(store.snapshot(), before); }
  finally { store.close(); }
});
test('原键持久回放不重复计数；异参、旧修订、未持锁及未决目标均拒绝', () => {
  const path = location(); let store = new SqliteStore(path); store.start(); store.createFixtureTask(task);
  assert.throws(() => store.prepareFixtureIntent(intent, () => { throw new Error('无租约'); }), /无租约/);
  assert.throws(() => store.prepareFixtureIntent({ ...intent, expectedRevision: 2 }, unlocked), /修订/);
  const saved = store.prepareFixtureIntent(intent, unlocked); store.close(); store = new SqliteStore(path); store.start();
  try { assert.deepEqual(store.prepareFixtureIntent(intent, () => { throw new Error('回放不得派发'); }), saved); assert.throws(() => store.prepareFixtureIntent({ ...intent, attemptId: 'different' }, unlocked), /同键/); assert.throws(() => store.prepareFixtureIntent({ ...intent, key: 'new', attemptId: 'new' }, unlocked), /未决/); assert.equal((store.snapshot().tasks as typeof task[])[0]!.count, 1); }
  finally { store.close(); }
});
test('只有确定未写入可回退；uncertain 重启仍保留计数及 held 槽位', () => {
  const path = location(); let store = new SqliteStore(path); store.start(); store.createFixtureTask(task); store.prepareFixtureIntent(intent, unlocked); store.cancelFixtureBeforeWrite(intent.attemptId);
  assert.equal((store.snapshot().tasks as typeof task[])[0]!.count, 0); assert.throws(() => store.cancelFixtureBeforeWrite(intent.attemptId), /不可回退/);
  store.prepareFixtureIntent({ ...intent, key: 'second', attemptId: 'second' }, unlocked); store.markFixtureUncertain('second'); store.close(); store = new SqliteStore(path); store.start();
  try { assert.throws(() => store.cancelFixtureBeforeWrite('second'), /不可回退/); assert.equal((store.snapshot().tasks as typeof task[])[0]!.count, 1); assert.equal((store.snapshot().slots as Array<{ state: string }>).filter(s => s.state === 'held').length, 1); }
  finally { store.close(); }
});
test('前置约束由数据库执行，非法外键不能写入', () => {
  const path = location(); const store = new SqliteStore(path); store.start(); const other = new DatabaseSync(path); other.exec('PRAGMA foreign_keys=ON');
  try { assert.throws(() => other.prepare("INSERT INTO fixture_attempts VALUES('orphan','missing','prepared')").run(), /FOREIGN KEY/); assert.equal((store.snapshot().attempts as unknown[]).length, 0); }
  finally { other.close(); store.close(); }
});
test('并发写锁竞争有界失败且不留半事务，释放后可重试', () => {
  const path = location(); const store = new SqliteStore(path); store.start(); const writer = new DatabaseSync(path); writer.exec('BEGIN IMMEDIATE');
  try { const started = performance.now(); assert.throws(() => store.createFixtureTask(task), /locked/); assert(performance.now() - started < 3000); writer.exec('ROLLBACK'); assert.equal((store.snapshot().tasks as unknown[]).length, 0); store.createFixtureTask(task); assert.equal((store.snapshot().tasks as unknown[]).length, 1); }
  finally { if (writer.isTransaction) writer.exec('ROLLBACK'); writer.close(); store.close(); }
});
test('最终提交前租约复核失效会回滚整笔事务', () => {
  const store = new SqliteStore(location()); store.start(); store.createFixtureTask(task); let calls = 0;
  try { const before = store.snapshot(); assert.throws(() => store.prepareFixtureIntent(intent, () => { if (++calls === 2) throw new Error('租约失效'); }), /租约失效/); assert.equal(calls, 2); assert.deepEqual(store.snapshot(), before); }
  finally { store.close(); }
});
test('WAL 中未 checkpoint 提交可一致备份，目标不覆盖，失败无冒充成功文件', () => {
  const path = location(); const store = new SqliteStore(path); store.start(); store.createFixtureTask(task); store.prepareFixtureIntent(intent, unlocked);
  try {
    assert(existsSync(path + '-wal')); const destination = path + '.backup'; store.backup(destination); const copy = new SqliteStore(destination); copy.start();
    try { assert.deepEqual(copy.snapshot(), store.snapshot()); assert.equal(copy.health().integrity, 'ok'); } finally { copy.close(); }
    const saved = readFileSync(destination); assert.throws(() => store.backup(destination), /已存在/); assert.deepEqual(readFileSync(destination), saved);
    assert.throws(() => store.backup(path), /与源相同/); assert(!readdirSync(join(path, '..')).some(p => p.endsWith('.tmp')));
  } finally { store.close(); }
});
test('读快照跨多表一致，并发已提交写入留给下一快照', () => {
  const path = location(); let writer: DatabaseSync; let inject = false;
  const store = new SqliteStore(path, stage => { if (stage === 'snapshot:read' && inject) { inject = false; writer.exec("BEGIN IMMEDIATE; INSERT INTO fixture_tasks VALUES('t2','g03-fixture-2',1,0,3); INSERT INTO fixture_events(kind,resourceId) VALUES('task_created','t2'); COMMIT;"); } });
  store.start(); writer = new DatabaseSync(path); store.createFixtureTask(task); inject = true;
  try { const snapshot = store.snapshot(); assert.equal((snapshot.tasks as unknown[]).length, 1); assert.equal((snapshot.events as unknown[]).length, 1); assert.equal((store.snapshot().tasks as unknown[]).length, 2); }
  finally { writer.close(); store.close(); }
});
test('备份生成后注入发布失败会清除临时文件，不发布成功目标', () => {
  const path = location(); const store = new SqliteStore(path, stage => { if (stage === 'backup:publish') throw new Error('发布失败'); }); store.start();
  try { assert.throws(() => store.backup(path + '.copy'), /发布失败/); assert(!existsSync(path + '.copy')); assert(!readdirSync(join(path, '..')).some(p => p.endsWith('.tmp'))); }
  finally { store.close(); }
});
test('未知高版本、其他应用库和损坏文件拒绝且不覆盖', () => {
  for (const kind of ['future', 'foreign', 'corrupt']) {
    const path = location();
    if (kind === 'corrupt') writeFileSync(path, 'not a database');
    else { const db = new DatabaseSync(path); db.exec(kind === 'future' ? 'PRAGMA application_id=1128548147; PRAGMA user_version=99' : 'CREATE TABLE unrelated(id TEXT)'); db.close(); }
    const before = readFileSync(path); assert.throws(() => new SqliteStore(path).start()); assert.deepEqual(readFileSync(path), before);
  }
});
test('递增迁移失败整体回滚，随后可重试至新版本并保留已有任务', () => {
  const path = location(); const db = new DatabaseSync(path);
  db.exec(`PRAGMA application_id=${0x43444733}; PRAGMA user_version=1; CREATE TABLE observations(scenario TEXT PRIMARY KEY,payload TEXT NOT NULL) STRICT; CREATE TABLE fixture_tasks(id TEXT PRIMARY KEY,target TEXT NOT NULL UNIQUE,revision INTEGER NOT NULL CHECK(revision>0),count INTEGER NOT NULL CHECK(count>=0),maxCount INTEGER NOT NULL CHECK(maxCount>0 AND count<=maxCount)) STRICT; INSERT INTO fixture_tasks VALUES('old','g03-fixture-old',1,0,3)`); db.close();
  assert.throws(() => new SqliteStore(path, stage => { if (stage === 'migration:2') throw new Error('迁移失败'); }).start(), /迁移失败/);
  const inspect = new DatabaseSync(path, { readOnly: true }); assert.equal(inspect.prepare('PRAGMA user_version').get()!.user_version, 1); assert.equal(inspect.prepare("SELECT count(*) n FROM sqlite_master WHERE name='fixture_attempts'").get()!.n, 0); inspect.close();
  const store = new SqliteStore(path); store.start(); try { assert.equal(store.health().schemaVersion, 3); assert.equal((store.snapshot().tasks as typeof task[])[0]!.id, 'old'); } finally { store.close(); }
});
