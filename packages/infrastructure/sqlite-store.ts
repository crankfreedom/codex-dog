import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, openSync, closeSync, fsyncSync, unlinkSync, linkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PersistenceError } from '../modules/persistence/ports.ts';
import type { FixtureIntentInput, FixtureTask, ObservationStorePort, PersistenceHealth } from '../modules/persistence/ports.ts';
import type { UsageObservation } from '../modules/quota/service.ts';

const applicationId = 0x43444733;
export const currentSchema = 2;
export class SqliteStore implements ObservationStorePort {
  private path: string;
  private db?: DatabaseSync;
  private fault?: (stage: string) => void;
  constructor(path: string, testFault?: (stage: string) => void) { this.path = resolve(path); this.fault = testFault; }
  start() {
    if (this.db) throw new Error('存储已启动');
    mkdirSync(dirname(this.path), { recursive: true });
    const db = new DatabaseSync(this.path);
    this.db = db;
    try {
      const version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
      const identity = Number(db.prepare('PRAGMA application_id').get()!.application_id);
      const tables = Number(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").get()!.n);
      if (version > currentSchema || version < 0) throw new PersistenceError('SCHEMA_UNSUPPORTED', '数据库版本超出支持范围');
      if (identity !== applicationId && (identity !== 0 || version !== 0 || tables !== 0)) throw new PersistenceError('DATABASE_IDENTITY_MISMATCH', '拒绝打开其他应用数据库');
      if (db.prepare('PRAGMA quick_check').get()!.quick_check !== 'ok') throw new PersistenceError('STORAGE_FAILURE', '数据库完整性检查失败');
      db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000;');
      this.transaction(() => {
        if (version < 1) {
          db.exec(`CREATE TABLE observations(scenario TEXT PRIMARY KEY, payload TEXT NOT NULL) STRICT;
            CREATE TABLE fixture_tasks(id TEXT PRIMARY KEY, target TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL CHECK(revision>0), count INTEGER NOT NULL CHECK(count>=0), maxCount INTEGER NOT NULL CHECK(maxCount>0 AND count<=maxCount)) STRICT;
            PRAGMA application_id=${applicationId}; PRAGMA user_version=1;`);
          this.fault?.('migration:1');
        }
        if (version < 2) {
          db.exec(`CREATE TABLE fixture_attempts(id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES fixture_tasks(id), state TEXT NOT NULL CHECK(state IN ('prepared','uncertain','cancelled_before_write'))) STRICT;
            CREATE TABLE fixture_slots(attemptId TEXT PRIMARY KEY REFERENCES fixture_attempts(id), target TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('held','released'))) STRICT;
            CREATE UNIQUE INDEX one_held_target ON fixture_slots(target) WHERE state='held';
            CREATE TABLE fixture_events(sequence INTEGER PRIMARY KEY, kind TEXT NOT NULL, resourceId TEXT NOT NULL) STRICT;
            CREATE TABLE fixture_operations(scope TEXT PRIMARY KEY, digest TEXT NOT NULL, result TEXT NOT NULL) STRICT;
            PRAGMA user_version=2;`);
          this.fault?.('migration:2');
        }
      });
      if (db.prepare('PRAGMA journal_mode=WAL').get()!.journal_mode !== 'wal') throw new PersistenceError('STORAGE_FAILURE', 'WAL 模式未生效');
      db.exec('PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=1000;');
      // 固定查询检查已知版本结构，不以 user_version 单独信任 schema。
      this.snapshot(); db.prepare('SELECT scenario,payload FROM observations LIMIT 0').all();
    } catch (error) { db.close(); this.db = undefined; throw error; }
  }
  private connection() { if (!this.db) throw new PersistenceError('APP_NOT_READY', '存储尚未启动'); return this.db; }
  private transaction<T>(work: () => T): T {
    const db = this.connection(); db.exec('BEGIN IMMEDIATE');
    try { const value = work(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  health(): PersistenceHealth {
    const db = this.connection();
    return { schemaVersion: Number(db.prepare('PRAGMA user_version').get()!.user_version), journalMode: String(db.prepare('PRAGMA journal_mode').get()!.journal_mode), sqliteVersion: String(db.prepare('SELECT sqlite_version() v').get()!.v), integrity: String(db.prepare('PRAGMA quick_check').get()!.quick_check) };
  }
  loadObservation(scenario: string): UsageObservation | undefined {
    const row = this.connection().prepare('SELECT payload FROM observations WHERE scenario=?').get(scenario);
    return row ? JSON.parse(String(row.payload)) as UsageObservation : undefined;
  }
  saveObservation(scenario: string, observation: UsageObservation) {
    this.transaction(() => this.connection().prepare('INSERT INTO observations VALUES(?,?) ON CONFLICT(scenario) DO UPDATE SET payload=excluded.payload').run(scenario, JSON.stringify(observation)));
  }
  createFixtureTask(task: FixtureTask) {
    if (!task.id || !task.target || !Number.isInteger(task.revision) || task.revision < 1 || task.count !== 0 || !Number.isInteger(task.maxCount) || task.maxCount < 1 || task.maxCount > 20) throw new PersistenceError('INVALID_ARGUMENT', '模拟任务无效');
    this.transaction(() => {
      this.connection().prepare('INSERT INTO fixture_tasks VALUES(?,?,?,?,?)').run(task.id, task.target, task.revision, task.count, task.maxCount);
      this.event('task_created', task.id); this.fault?.('task:created');
    });
  }
  prepareFixtureIntent(input: FixtureIntentInput, assertLease: (target: string) => void): Record<string, unknown> {
    if (!input.key || !input.clientId || !input.attemptId || !input.taskId || !Number.isInteger(input.expectedRevision)) throw new PersistenceError('INVALID_ARGUMENT', '模拟意图无效');
    const scope = JSON.stringify([input.clientId, 'fixture.prepare', input.key]);
    const digest = createHash('sha256').update(JSON.stringify([input.taskId, input.expectedRevision, input.attemptId])).digest('hex');
    return this.transaction(() => {
      const db = this.connection();
      const prior = db.prepare('SELECT digest,result FROM fixture_operations WHERE scope=?').get(scope);
      if (prior) { if (prior.digest !== digest) throw new PersistenceError('IDEMPOTENCY_CONFLICT', '同键不同参数'); return JSON.parse(String(prior.result)) as Record<string, unknown>; }
      const task = db.prepare('SELECT * FROM fixture_tasks WHERE id=?').get(input.taskId);
      if (!task || task.revision !== input.expectedRevision) throw new PersistenceError('REVISION_CONFLICT', '模拟任务修订冲突');
      assertLease(String(task.target));
      if (Number(task.count) >= Number(task.maxCount)) throw new PersistenceError('RESUME_LIMIT', '次数达到上限');
      if (db.prepare("SELECT 1 FROM fixture_slots WHERE target=? AND state='held'").get(task.target!)) throw new PersistenceError('UNRESOLVED_ATTEMPT', '目标仍有未决槽位');
      db.prepare("INSERT INTO fixture_attempts VALUES(?,?,'prepared')").run(input.attemptId, input.taskId);
      this.fault?.('intent:attempt');
      db.prepare("INSERT INTO fixture_slots VALUES(?,?,'held')").run(input.attemptId, task.target!);
      db.prepare('UPDATE fixture_tasks SET count=count+1 WHERE id=?').run(input.taskId);
      this.fault?.('intent:count');
      this.event('intent_prepared', input.attemptId);
      const result = { attemptId: input.attemptId, taskId: input.taskId, state: 'prepared', slot: 'held', count: Number(task.count) + 1 };
      db.prepare('INSERT INTO fixture_operations VALUES(?,?,?)').run(scope, digest, JSON.stringify(result));
      this.fault?.('intent:commit'); assertLease(String(task.target)); return result;
    });
  }
  markFixtureUncertain(attemptId: string) {
    this.transaction(() => {
      const result = this.connection().prepare("UPDATE fixture_attempts SET state='uncertain' WHERE id=? AND state='prepared'").run(attemptId);
      if (Number(result.changes)) this.event('intent_uncertain', attemptId);
    });
  }
  cancelFixtureBeforeWrite(attemptId: string) {
    this.transaction(() => {
      const db = this.connection(); const attempt = db.prepare('SELECT * FROM fixture_attempts WHERE id=?').get(attemptId);
      if (!attempt || attempt.state !== 'prepared') throw new PersistenceError('UNRESOLVED_ATTEMPT', '未决或已处理的意图不可回退');
      db.prepare("UPDATE fixture_attempts SET state='cancelled_before_write' WHERE id=?").run(attemptId);
      db.prepare("UPDATE fixture_slots SET state='released' WHERE attemptId=?").run(attemptId);
      db.prepare('UPDATE fixture_tasks SET count=count-1 WHERE id=?').run(attempt.taskId!);
      this.event('cancelled_before_write', attemptId); this.fault?.('intent:cancel');
    });
  }
  private event(kind: string, resourceId: string) { this.connection().prepare('INSERT INTO fixture_events(kind,resourceId) VALUES(?,?)').run(kind, resourceId); }
  snapshot(): Record<string, unknown> {
    const db = this.connection(); db.exec('BEGIN');
    try {
      const tasks = db.prepare('SELECT * FROM fixture_tasks ORDER BY id LIMIT 200').all();
      this.fault?.('snapshot:read');
      const result = { tasks, attempts: db.prepare('SELECT * FROM fixture_attempts ORDER BY id LIMIT 200').all(), slots: db.prepare('SELECT * FROM fixture_slots ORDER BY attemptId LIMIT 200').all(), events: db.prepare('SELECT * FROM fixture_events ORDER BY sequence LIMIT 200').all(), operations: Number(db.prepare('SELECT count(*) n FROM fixture_operations').get()!.n) };
      db.exec('COMMIT'); return result;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  backup(destination: string) {
    const path = resolve(destination);
    if (path === this.path || existsSync(path)) throw new PersistenceError('INVALID_ARGUMENT', '备份目标已存在或与源相同');
    mkdirSync(dirname(path), { recursive: true }); const temporary = path + '.' + randomUUID() + '.tmp';
    try {
      // VACUUM INTO 使用 SQLite 一致快照，包含尚未 checkpoint 的 WAL 提交。
      this.connection().prepare('VACUUM INTO ?').run(temporary);
      this.fault?.('backup:publish');
      const check = new DatabaseSync(temporary, { readOnly: true });
      try { if (check.prepare('PRAGMA integrity_check').get()!.integrity_check !== 'ok') throw new Error('备份完整性检查失败'); } finally { check.close(); }
      const fd = openSync(temporary, 'r+'); try { fsyncSync(fd); } finally { closeSync(fd); }
      linkSync(temporary, path); // 原子发布且不覆盖既有备份。
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
  close() { const db = this.db; if (!db) return; this.db = undefined; db.close(); }
}
