import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, lstatSync, openSync, writeFileSync, fsyncSync, closeSync, readFileSync, unlinkSync, statSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';

export class LeaseError extends Error { code: string; constructor(code: string, message: string) { super(message); this.code = code; } }
export interface TargetLease { target: string; token: string;pid:number }
export class TargetLeaseAdapter {
  private location?: { directory: string; verified: boolean };
  private started = false;
  private owned = new Map<string, TargetLease>();
  constructor(location?: { directory: string; verified: boolean }) { this.location = location; }
  start() {
    if (!this.location?.verified || !isAbsolute(this.location.directory) || this.location.directory.replaceAll('/', '\\').startsWith('\\\\')) throw new LeaseError('TARGET_LOCK_UNVERIFIED', '必须明确核对旧版同一绝对锁目录');
    mkdirSync(this.location.directory, { recursive: true });
    if (lstatSync(this.location.directory).isSymbolicLink()) throw new LeaseError('TARGET_LOCK_UNVERIFIED', '锁目录不能是符号链接');
    this.started = true;
  }
  private path(target: string) {
    if (!this.started || !this.location) throw new LeaseError('TARGET_LOCK_UNVERIFIED', '锁目录未就绪');
    if (!target || target.length > 200) throw new LeaseError('INVALID_ARGUMENT', '模拟目标无效');
    return join(this.location.directory, createHash('sha256').update(target).digest('hex') + '.lock');
  }
  private read(path: string): { pid: number; token: string } {
    if (lstatSync(path).isSymbolicLink() || statSync(path).size > 4096) throw new LeaseError('TARGET_LOCK_UNVERIFIED', '锁文件不可确认');
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!raw || typeof raw !== 'object' || !('pid' in raw) || !Number.isInteger(raw.pid) || Number(raw.pid) < 1 || !('token' in raw) || typeof raw.token !== 'string' || !raw.token || Object.keys(raw).some(k => !['pid', 'token'].includes(k))) throw new LeaseError('TARGET_LOCK_UNVERIFIED', '锁文件格式不可确认');
    return raw as { pid: number; token: string };
  }
  acquire(target: string): TargetLease {
    const path = this.path(target); let fd: number;
    try { fd = openSync(path, 'wx', 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new LeaseError('TARGET_BUSY', '目标已有锁，拒绝自动回收'); throw new LeaseError('TARGET_LOCK_UNVERIFIED', '无法取得目标锁'); }
    const lease = { target, token: randomUUID(),pid:process.pid };
    // 写入失败保留不确定文件，不能抢删或假定无锁。
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid, token: lease.token })); fsyncSync(fd); }
    finally { closeSync(fd); }
    this.owned.set(lease.token, lease); return lease;
  }
  assertOwned(lease: TargetLease) {
    try { const record = this.read(this.path(lease.target)); if (this.owned.get(lease.token) !== lease || record.pid !== process.pid || record.token !== lease.token) throw new Error('租约已替换'); }
    catch { throw new LeaseError('TARGET_LOCK_UNVERIFIED', '不能确认当前目标租约'); }
  }
  release(lease: TargetLease) {
    this.assertOwned(lease); unlinkSync(this.path(lease.target)); this.owned.delete(lease.token);
  }
  releaseRecorded(lease:TargetLease){
    if(lease.pid===process.pid){const owned=this.owned.get(lease.token);if(!owned)throw new LeaseError('TARGET_LOCK_UNVERIFIED','当前进程没有该历史租约');this.release(owned);return;}
    try{process.kill(lease.pid,0);throw new LeaseError('TARGET_BUSY','原持有者仍在运行，不释放历史锁');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}
    const path=this.path(lease.target),record=this.read(path);if(record.pid!==lease.pid||record.token!==lease.token)throw new LeaseError('TARGET_LOCK_UNVERIFIED','历史锁身份已变化');unlinkSync(path);
  }
  close() {
    let failed = false;
    for (const lease of this.owned.values()) { try { this.release(lease); } catch { failed = true; } }
    this.started = false;
    if (failed) throw new LeaseError('TARGET_LOCK_UNVERIFIED', '部分目标锁未释放，保留待核对');
  }
}
