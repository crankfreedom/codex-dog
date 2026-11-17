import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, openSync, closeSync, fsyncSync, unlinkSync, linkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PersistenceError } from '../modules/persistence/ports.ts';
import type { FixtureIntentInput, FixtureTask, ObservationStorePort, PersistenceHealth } from '../modules/persistence/ports.ts';
import type { UsageObservation } from '../modules/quota/service.ts';
import { defaultAppearance, defaultMonitoring } from '../contracts/stage3.ts';
import { Stage3Error } from '../modules/persistence/stage3-ports.ts';
import type { Stage3StorePort,SettingView,HistoryFilter,HistoryEvent,ExportOperation } from '../modules/persistence/stage3-ports.ts';

const applicationId = 0x43444733;
export const currentSchema = 3;
export class SqliteStore implements ObservationStorePort,Stage3StorePort {
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
        if(version<3){
          db.exec(`CREATE TABLE app_settings(section TEXT PRIMARY KEY,revision INTEGER NOT NULL CHECK(revision>0),payload TEXT NOT NULL) STRICT;
            CREATE TABLE app_setting_operations(scope TEXT PRIMARY KEY,digest TEXT NOT NULL,result TEXT NOT NULL) STRICT;
            CREATE TABLE app_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,type TEXT NOT NULL,reason TEXT NOT NULL,revision INTEGER) STRICT;
            CREATE INDEX app_events_filter ON app_events(type,reason,sequence);
            CREATE TABLE app_history_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
            CREATE TABLE app_exports(id TEXT PRIMARY KEY,owner TEXT NOT NULL,operationKey TEXT NOT NULL,digest TEXT NOT NULL,payload TEXT NOT NULL,UNIQUE(owner,operationKey)) STRICT;
            CREATE TABLE app_export_cancellations(owner TEXT NOT NULL,key TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(owner,key)) STRICT;
            PRAGMA user_version=3;`);
          db.prepare('INSERT INTO app_settings VALUES(?,1,?)').run('appearance',JSON.stringify(defaultAppearance));
          db.prepare('INSERT INTO app_settings VALUES(?,1,?)').run('monitoring',JSON.stringify(defaultMonitoring));
          db.prepare('INSERT INTO app_history_meta VALUES(?,?)').run('cursor',randomUUID()+randomUUID());
          this.fault?.('migration:3');
        }
      });
      if (db.prepare('PRAGMA journal_mode=WAL').get()!.journal_mode !== 'wal') throw new PersistenceError('STORAGE_FAILURE', 'WAL 模式未生效');
      db.exec('PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=1000;');
      // 固定查询检查已知版本结构，不以 user_version 单独信任 schema。
      this.snapshot(); db.prepare('SELECT scenario,payload FROM observations LIMIT 0').all();this.readSetting('appearance');this.readSetting('monitoring');this.cursorKey();
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
  readSetting(section:SettingView['section']):SettingView{
    const row=this.connection().prepare('SELECT revision,payload FROM app_settings WHERE section=?').get(section);
    if(!row)throw new Stage3Error('STORAGE_FAILURE','设置分区缺失');
    return {section,revision:Number(row.revision),values:JSON.parse(String(row.payload))};
  }
  commitSetting(input:Parameters<Stage3StorePort['commitSetting']>[0]):SettingView{
    return this.transaction(()=>{
      const db=this.connection();const scope=JSON.stringify([input.owner,'settings.update',input.section,input.key]);
      const prior=db.prepare('SELECT digest,result FROM app_setting_operations WHERE scope=?').get(scope);
      if(prior){if(prior.digest!==input.digest)throw new Stage3Error('IDEMPOTENCY_CONFLICT','同键不能保存不同设置');return JSON.parse(String(prior.result));}
      if(Number(db.prepare('SELECT count(*) n FROM app_setting_operations').get()!.n)>=2048)throw new Stage3Error('CLIENT_LIMIT','设置幂等记录达到上限');
      const current=this.readSetting(input.section);if(current.revision!==input.expectedRevision)throw new Stage3Error('REVISION_CONFLICT','设置已变化，请重新读取');
      const result={section:input.section,revision:current.revision+1,values:input.values};
      db.prepare('UPDATE app_settings SET revision=?,payload=? WHERE section=?').run(result.revision,JSON.stringify(input.values),input.section);
      db.prepare('INSERT INTO app_setting_operations VALUES(?,?,?)').run(scope,input.digest,JSON.stringify(result));
      db.prepare('INSERT INTO app_events(at,type,reason,revision) VALUES(?,?,?,?)').run(input.at,'settings.updated',input.section,result.revision);
      this.fault?.('settings:commit');return result;
    });
  }
  appendRuntime(type:'runtime.started'|'runtime.stopping',mode:'fixture'|'live-readonly',at:string){this.connection().prepare('INSERT INTO app_events(at,type,reason) VALUES(?,?,?)').run(at,type,mode);}
  eventBoundary(){return Number(this.connection().prepare('SELECT coalesce(max(sequence),0) n FROM app_events').get()!.n);}
  eventPage(filter:HistoryFilter,boundary:number,after:number,limit:number):HistoryEvent[]{
    const rows=this.connection().prepare(`SELECT sequence,at,type,reason,revision FROM app_events WHERE sequence>? AND sequence<=?
      AND (? IS NULL OR at>=?) AND (? IS NULL OR at<=?) AND (? IS NULL OR type=?) AND (? IS NULL OR reason=?) ORDER BY sequence LIMIT ?`).all(after,boundary,filter.from??null,filter.from??null,filter.to??null,filter.to??null,filter.type??null,filter.type??null,filter.reason??null,filter.reason??null,limit);
    return rows.map(row=>({sequence:Number(row.sequence),at:String(row.at),type:String(row.type),reason:String(row.reason),revision:row.revision===null?null:Number(row.revision),source:'local'}));
  }
  cursorKey(){const row=this.connection().prepare("SELECT value FROM app_history_meta WHERE key='cursor'").get();if(!row)throw new Stage3Error('STORAGE_FAILURE','历史游标密钥缺失');return String(row.value);}
  createExport(input:Parameters<Stage3StorePort['createExport']>[0]):ExportOperation{
    return this.transaction(()=>{
      const db=this.connection();const prior=db.prepare('SELECT digest,payload FROM app_exports WHERE owner=? AND operationKey=?').get(input.actor.clientId,input.key);
      if(prior){if(prior.digest!==input.digest)throw new Stage3Error('IDEMPOTENCY_CONFLICT','同键导出条件不同');return JSON.parse(String(prior.payload));}
      if(Number(db.prepare('SELECT count(*) n FROM app_exports').get()!.n)>=1000)throw new Stage3Error('CLIENT_LIMIT','导出操作记录达到上限');
      const result:ExportOperation={id:input.id,kind:'events.export',owner:input.actor.clientId,state:'accepted',createdAt:input.at,updatedAt:input.at,boundary:input.boundary,written:0,fileName:null,error:null,actor:input.actor,cancelRequested:false,targetName:input.targetName};
      db.prepare('INSERT INTO app_exports VALUES(?,?,?,?,?)').run(input.id,input.actor.clientId,input.key,input.digest,JSON.stringify(result));return result;
    });
  }
  getExport(id:string,owner:string,allowAll=false):ExportOperation{const row=this.connection().prepare('SELECT payload FROM app_exports WHERE id=? AND (owner=? OR ?=1)').get(id,owner,allowAll?1:0);if(!row)throw new Stage3Error('OPERATION_NOT_FOUND','没有该客户端拥有的导出操作');return JSON.parse(String(row.payload));}
  listExports(owner:string,limit:number,allowAll=false):ExportOperation[]{return this.connection().prepare('SELECT payload FROM app_exports WHERE owner=? OR ?=1 ORDER BY rowid DESC LIMIT ?').all(owner,allowAll?1:0,limit).map(row=>JSON.parse(String(row.payload)));}
  saveExport(operation:ExportOperation){this.transaction(()=>{
    const before=this.getExport(operation.id,operation.owner);if(['succeeded','failed','cancelled'].includes(before.state))return;
    operation={...operation,cancelRequested:before.cancelRequested||operation.cancelRequested};
    this.connection().prepare('UPDATE app_exports SET payload=? WHERE id=? AND owner=?').run(JSON.stringify(operation),operation.id,operation.owner);
    if(['succeeded','failed','cancelled'].includes(operation.state))this.connection().prepare('INSERT INTO app_events(at,type,reason) VALUES(?,?,?)').run(operation.updatedAt,'export.'+(operation.state==='succeeded'?'completed':operation.state==='cancelled'?'cancelled':'failed'),operation.error??'completed');
  });}
  cancelExport(id:string,owner:string,key:string,allowAll=false):ExportOperation{return this.transaction(()=>{
    const db=this.connection();const previous=db.prepare('SELECT id FROM app_export_cancellations WHERE owner=? AND key=?').get(owner,key);
    if(previous&&previous.id!==id)throw new Stage3Error('IDEMPOTENCY_CONFLICT','同键不能取消不同操作');
    const operation=this.getExport(id,owner,allowAll);
    if(!previous){if(Number(db.prepare('SELECT count(*) n FROM app_export_cancellations').get()!.n)>=2048)throw new Stage3Error('CLIENT_LIMIT','取消幂等记录达到上限');db.prepare('INSERT INTO app_export_cancellations VALUES(?,?,?)').run(owner,key,id);}
    if(['accepted','running'].includes(operation.state)){operation.cancelRequested=true;db.prepare('UPDATE app_exports SET payload=? WHERE id=?').run(JSON.stringify(operation),id);}return operation;
  });}
  recoverExports(at:string):ExportOperation[]{const active=this.connection().prepare('SELECT payload FROM app_exports').all().map(row=>JSON.parse(String(row.payload)) as ExportOperation);for(const operation of active)if(operation.state==='accepted'||operation.state==='running')this.saveExport({...operation,state:'failed',updatedAt:at,error:'PROCESS_INTERRUPTED'});return active;}
}
