import type { Request, Response } from '../contracts/protocol.ts';
import { failure, responseSchema,scopeSchema } from '../contracts/protocol.ts';
import type { Scope } from '../contracts/protocol.ts';
import type { ActorRef } from '../modules/persistence/stage3-ports.ts';

export interface RuntimeChild { pid: number | undefined; send(value: unknown): void; kill(): void; onMessage(listener: (message: unknown) => void): void; onExit(listener: () => void): void }
export interface SupervisorOptions { spawn(): RuntimeChild; newId(): string; now(): number; heartbeatTimeout?: number; requestTimeout?: number; startupTimeout?: number; restartDelay?: number; maxRestarts?: number; authorize?:(actor:ActorRef,scope:Scope)=>void;notify?:(kind:'quota_recovered'|'task_completed'|'reset_result')=>void }
export class WorkerSupervisor {
  private options: SupervisorOptions;
  private child?: RuntimeChild;
  private closing = false;
  private state = 'stopped';
  private lastBeat = 0;
  private restarts = 0;
  private generation = 0;
  private reason: string | null = null;
  private provider?: Record<string, unknown>;
  private schemaVersion:number|null=null;
  private monitor?: NodeJS.Timeout;
  private restartTimer?: NodeJS.Timeout;
  private pending = new Map<string, { requestId: string; resolve(value: Response): void; timer: NodeJS.Timeout }>();
  constructor(options: SupervisorOptions) { this.options = options; }
  health() { return { schemaVersion:this.schemaVersion,state: this.state, workerPid: this.child?.pid ?? null, inFlight: this.pending.size, heartbeatAgeMs: this.lastBeat ? Math.max(0, this.options.now() - this.lastBeat) : null, restartCount: this.restarts, maxRestarts: this.options.maxRestarts ?? 3, reason: this.reason, ...(this.provider ? { provider: this.provider } : {}) }; }
  async start() {
    if (this.monitor) throw new Error('Supervisor already started');
    this.monitor = setInterval(() => {
      if (this.state === 'running' && this.options.now() - this.lastBeat > (this.options.heartbeatTimeout ?? 2500)) {
        this.reason = 'heartbeat_timeout'; this.state = 'restarting'; this.rejectPending('APP_NOT_READY'); this.child?.kill();
      }
    }, 250);
    await this.boot();
  }
  private boot(): Promise<void> {
    if (this.closing) return Promise.reject(new Error('应用正在退出'));
    this.state = this.restarts ? 'restarting' : 'starting';
    const child = this.options.spawn(); this.child = child;
    const generation = ++this.generation;
    return new Promise((resolve, reject) => {
      let ready = false;
      const timer = setTimeout(() => { this.reason = 'startup_timeout'; reject(new Error('业务进程启动超时')); child.kill(); }, this.options.startupTimeout ?? 5000);
      child.onMessage(raw => {
        if (generation !== this.generation || !raw || typeof raw !== 'object') return;
        const message = raw as { type?: string; id?: string; result?: unknown; provider?: Record<string, unknown>;actor?:ActorRef;scope?:Scope;kind?:string;schemaVersion?:number };
        if(message.type==='authorize'&&message.id){let allowed=false,code='AUTH_REVOKED';try{if(this.closing){code='APP_STOPPING';throw new Error();}if(!message.actor||!scopeSchema.safeParse(message.scope).success||!this.options.authorize)throw new Error();this.options.authorize(message.actor,message.scope!);allowed=true;}catch(error){if(error&&typeof error==='object'&&'code'in error&&['APP_STOPPING','PERMISSION_DENIED'].includes(String(error.code)))code=String(error.code);}child.send({type:'authorized',id:message.id,allowed,code:allowed?undefined:code});return;}
        if(this.closing)return;
        if(message.type==='notification'){if(['quota_recovered','task_completed','reset_result'].includes(message.kind??''))this.options.notify?.(message.kind as 'quota_recovered'|'task_completed'|'reset_result');return;}
        if (message.provider) this.provider = message.provider;if(Number.isInteger(message.schemaVersion)&&Number(message.schemaVersion)>0)this.schemaVersion=Number(message.schemaVersion);
        if (message.type === 'ready') { ready = true; clearTimeout(timer); this.state = 'running'; this.lastBeat = this.options.now(); resolve(); }
        else if (message.type === 'heartbeat') this.lastBeat = this.options.now();
        else if (message.id) {
          const item = this.pending.get(message.id); if (!item) return;
          clearTimeout(item.timer); this.pending.delete(message.id);
          const result = responseSchema.safeParse(message.result);
          item.resolve(result.success ? result.data : failure('PROTOCOL_INCOMPATIBLE', '业务进程响应无效', item.requestId));
        }
      });
      child.onExit(() => {
        clearTimeout(timer);
        if (generation !== this.generation) return;
        this.child = undefined; this.provider = undefined; this.rejectPending(this.closing ? 'APP_STOPPING' : 'APP_NOT_READY');
        if (!ready) reject(new Error('业务进程提前退出'));
        if (this.closing) { this.state = 'stopped'; return; }
        if (this.restarts >= (this.options.maxRestarts ?? 3)) { this.state = 'failed'; this.reason = 'restart_limit_reached'; return; }
        this.state = 'restarting'; this.reason ??= 'worker_exited'; this.restarts += 1;
        this.restartTimer = setTimeout(() => { void this.boot().catch(() => {}); }, (this.options.restartDelay ?? 300) * 2 ** (this.restarts - 1));
      });
    });
  }
  invoke(request: Request,actor?:ActorRef): Promise<Response> {
    if (this.closing) return Promise.resolve(failure('APP_STOPPING', '应用正在退出', request.requestId));
    if (this.state !== 'running' || !this.child) return Promise.resolve(failure('APP_NOT_READY', '业务进程未就绪或正在恢复', request.requestId));
    return new Promise(resolve => {
      const id = this.options.newId();
      const timer = setTimeout(() => { this.pending.delete(id); resolve(failure('READ_TIMEOUT', '业务进程读取超时', request.requestId)); }, this.options.requestTimeout ?? 5000);
      this.pending.set(id, { requestId: request.requestId, resolve, timer });
      try { this.child!.send({ type: 'invoke', id, request,actor }); }
      catch { clearTimeout(timer); this.pending.delete(id); resolve(failure('APP_NOT_READY', '业务进程连接已失效', request.requestId)); }
    });
  }
  private rejectPending(code: string) { for (const item of this.pending.values()) { clearTimeout(item.timer); item.resolve(failure(code, '业务进程状态已变化', item.requestId)); } this.pending.clear(); }
  testControl(type: string) { this.child?.send({ type }); }
  environment(type:'suspend'|'resume'){if(!this.closing)this.child?.send({type:'environment:'+type});}
  async stop() {
    this.closing = true; this.state = 'stopping'; clearInterval(this.monitor); clearTimeout(this.restartTimer); this.rejectPending('APP_STOPPING');
    const child = this.child;
    if (child) await new Promise<void>(resolve => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 3000);
      child.onExit(() => { clearTimeout(timer); resolve(); });
      try { child.send({ type: 'stop' }); } catch { clearTimeout(timer); child.kill(); resolve(); }
    });
    this.state = 'stopped';
  }
}
