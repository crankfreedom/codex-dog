import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GoalReadPort, GoalState } from '../modules/codex-readonly/ports.ts';

const statuses = new Set(['active', 'paused', 'blocked', 'usage_limited', 'budget_limited', 'complete']);
export class CodexGoalReadonly implements GoalReadPort {
  private directory: string;
  constructor(directory: string) { this.directory = directory; }
  read(threadId: string): GoalState {
    if (!/^[a-f0-9-]{36}$/i.test(threadId)) return { availability: 'unknown', current: null, reason: 'invalid_thread' };
    const path = join(this.directory, 'goals_1.sqlite');
    if (!existsSync(path)) return { availability: 'unknown', current: null, reason: 'goal_database_missing' };
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(path, { readOnly: true }); db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000; BEGIN');
      const names = db.prepare('PRAGMA table_info(thread_goals)').all().map(row => row.name);
      if (!['thread_id', 'goal_id', 'status'].every(name => names.includes(name))) return { availability: 'unknown', current: null, reason: 'goal_schema_unsupported' };
      const rows = db.prepare('SELECT goal_id,status FROM thread_goals WHERE thread_id=? LIMIT 2').all(threadId);
      if (!rows.length) return { availability: 'known', current: null, reason: null };
      if (rows.length !== 1 || typeof rows[0]!.goal_id !== 'string' || !rows[0]!.goal_id || typeof rows[0]!.status !== 'string' || !statuses.has(rows[0]!.status)) return { availability: 'unknown', current: null, reason: 'goal_state_unsupported' };
      return { availability: 'known', current: { id: rows[0]!.goal_id, status: rows[0]!.status }, reason: null };
    } catch { return { availability: 'unknown', current: null, reason: 'goal_read_failed' }; }
    finally { db?.close(); }
  }
}
