import { connect, type Socket } from 'node:net';
import { readdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { readToolNames, ReadError } from '../modules/codex-readonly/ports.ts';
import type { CodexReadPort, ReadTool } from '../modules/codex-readonly/ports.ts';

const frameLimit = 8 * 1024 * 1024;
interface Tool { name: string; namespace: string; inputSchema: { properties?: Record<string, unknown>; required?: string[] } }
export class CodexDesktopReadonly implements CodexReadPort {
  private options: { callerThreadId?: string; pipe?: string; timeoutMs?: number; discoverNames?: () => string[] };
  private selected?: string;
  private socket?: Socket;
  private opening?: Promise<void>;
  private stopped = false;
  private buffer = Buffer.alloc(0);
  private sequence = 0;
  private tools = new Map<string, Tool>();
  private counts = new Map<string, number>();
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  constructor(options: CodexDesktopReadonly['options']) { this.options = options; }
  discover() {
    if (process.platform !== 'win32' && !this.options.discoverNames) throw new ReadError('PROVIDER_UNAVAILABLE', '当前只读桌面适配仅验证 Windows');
    const names = (this.options.discoverNames?.() ?? readdirSync('\\\\.\\pipe\\')).filter(n => /^codex-app-tools-[a-zA-Z0-9-]{1,100}$/.test(n)).sort();
    return { candidates: names.map(name => ({ candidateId: createHash('sha256').update(name).digest('hex').slice(0, 24), selected: this.selected === '\\\\.\\pipe\\' + name })), selectionRequired: !this.options.pipe && names.length !== 1 };
  }
  connected() { return !!this.socket && !this.socket.destroyed && this.tools.size === readToolNames.length; }
  audit() { return Object.fromEntries(this.counts); }
  async start() {
    if (this.stopped) throw new ReadError('APP_STOPPING', '只读连接已关闭');
    if (this.connected()) return;
    this.opening ??= this.open().finally(() => { this.opening = undefined; });
    await this.opening;
  }
  private async open() {
    if (!this.options.callerThreadId || !/^[a-f0-9-]{36}$/i.test(this.options.callerThreadId)) throw new ReadError('PROVIDER_SELECTION_REQUIRED', '请明确指定本机调用会话');
    if (!this.selected) {
      if (this.options.pipe) {
        if (!/^\\\\\.\\pipe\\codex-app-tools-[a-zA-Z0-9-]{1,100}$/.test(this.options.pipe)) throw new ReadError('PROVIDER_SELECTION_REQUIRED', '只接受明确选择的本机 Codex 工具管道');
        this.selected = this.options.pipe;
      } else {
        const names = this.options.discoverNames?.() ?? readdirSync('\\\\.\\pipe\\');
        const eligible = names.filter(n => /^codex-app-tools-[a-zA-Z0-9-]{1,100}$/.test(n));
        if (eligible.length !== 1) throw new ReadError(eligible.length ? 'PROVIDER_SELECTION_REQUIRED' : 'PROVIDER_UNAVAILABLE', '桌面工具管道不可唯一确认');
        this.selected = '\\\\.\\pipe\\' + eligible[0];
      }
    }
    this.buffer = Buffer.alloc(0); const socket = connect(this.selected); this.socket = socket;
    socket.on('data', data => this.receive(socket, data));
    socket.on('error', () => this.disconnect(socket, new ReadError('PROVIDER_UNAVAILABLE', '桌面只读连接失败')));
    socket.on('close', () => this.disconnect(socket, new ReadError('PROVIDER_UNAVAILABLE', '桌面只读连接已关闭')));
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { socket.destroy(); reject(new ReadError('READ_TIMEOUT', '桌面只读连接超时')); }, this.options.timeoutMs ?? 5000);
        socket.once('connect', () => { clearTimeout(timer); resolve(); });
        socket.once('error', () => { clearTimeout(timer); reject(new ReadError('PROVIDER_UNAVAILABLE', '桌面只读连接失败')); });
      });
      const raw = await this.request('tools/list', { threadStartKind: 'all' }) as { tools?: Tool[] };
      if (!Array.isArray(raw?.tools)) throw new ReadError('PROVIDER_SCHEMA_UNSUPPORTED', '桌面工具目录不兼容');
      for (const name of readToolNames) {
        const found = raw.tools.filter(t => t?.name === name);
        if (found.length !== 1 || typeof found[0]!.namespace !== 'string' || !found[0]!.namespace || !found[0]!.inputSchema?.properties) throw new ReadError('PROVIDER_SCHEMA_UNSUPPORTED', '缺失必要只读工具契约');
        const fields = name === 'get_usage_limits' ? [] : name === 'list_threads' ? ['mode', 'source', 'hostId', 'limit', 'cursor', 'archived'] : ['threadId', 'hostId', 'turnLimit', 'includeOutputs', 'maxOutputCharsPerItem'];
        if (!fields.every(field => field in found[0]!.inputSchema.properties!)) throw new ReadError('PROVIDER_SCHEMA_UNSUPPORTED', '只读工具参数不兼容');
        this.tools.set(name, found[0]!);
      }
    } catch (error) { this.disconnect(socket, error instanceof ReadError ? error : new ReadError('PROVIDER_SCHEMA_UNSUPPORTED', '桌面只读握手失败')); throw error; }
  }
  private receive(socket: Socket, data: Buffer) {
    if (socket !== this.socket) return;
    if (this.buffer.length + data.length > frameLimit + 4) { this.disconnect(socket, new ReadError('PROVIDER_SCHEMA_UNSUPPORTED', '桌面响应超出边界')); return; }
    this.buffer = Buffer.concat([this.buffer, data]);
    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32LE(0);
      if (!size || size > frameLimit) { this.disconnect(socket, new ReadError('PROVIDER_SCHEMA_UNSUPPORTED', '桌面响应帧无效')); return; }
      if (this.buffer.length < size + 4) return;
      let value: { id?: number; result?: unknown; error?: unknown };
      try { value = JSON.parse(this.buffer.subarray(4, size + 4).toString('utf8')); }
      catch { this.disconnect(socket, new ReadError('PROVIDER_SCHEMA_UNSUPPORTED', '桌面响应 JSON 无效')); return; }
      this.buffer = this.buffer.subarray(size + 4); const item = value && this.pending.get(value.id!); if (!item) continue;
      clearTimeout(item.timer); this.pending.delete(value.id!);
      if (value.error) item.reject(new ReadError('PROVIDER_UNAVAILABLE', '桌面只读工具拒绝请求')); else item.resolve(value.result);
    }
  }
  private request(method: 'tools/list' | 'tools/call', params: unknown): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.destroyed) return Promise.reject(new ReadError('PROVIDER_UNAVAILABLE', '桌面只读连接不可用'));
    const id = ++this.sequence; const payload = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params })); const header = Buffer.alloc(4); header.writeUInt32LE(payload.length);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new ReadError('READ_TIMEOUT', '桌面只读请求超时')); this.disconnect(socket, new ReadError('READ_TIMEOUT', '桌面只读请求超时')); }, this.options.timeoutMs ?? 5000);
      this.pending.set(id, { resolve, reject, timer });
      socket.write(Buffer.concat([header, payload]), error => { if (error) this.disconnect(socket, new ReadError('PROVIDER_UNAVAILABLE', '桌面只读请求失败')); });
    });
  }
  async read(name: ReadTool, params: Record<string, unknown>) {
    if (!readToolNames.includes(name)) throw new ReadError('PERMISSION_DENIED', '只允许三项桌面读取工具');
    if (name === 'get_usage_limits' && Object.keys(params).length || name === 'list_threads' && (params.mode !== 'history' || params.source !== 'codex' || params.hostId !== 'local' || !Number.isInteger(params.limit) || Number(params.limit) < 1 || Number(params.limit) > 50) || name === 'read_thread' && (params.hostId !== 'local' || params.turnLimit !== 1 || params.includeOutputs !== false || params.maxOutputCharsPerItem !== 0 || typeof params.threadId !== 'string' || !/^[a-f0-9-]{36}$/i.test(params.threadId))) throw new ReadError('PERMISSION_DENIED', '读取必须限定本机、分页和无正文输出');
    if (this.pending.size >= 32) throw new ReadError('PROVIDER_UNAVAILABLE', '只读并发请求达到上限');
    await this.start(); const tool = this.tools.get(name)!;
    if (Object.keys(params).some(key => !(key in tool.inputSchema.properties!)) || tool.inputSchema.required?.some(key => !(key in params))) throw new ReadError('INVALID_ARGUMENT', '参数不符合已探测只读工具契约');
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
    const raw = await this.request('tools/call', { namespace: tool.namespace, tool: name, arguments: params, callerSource: 'codex', threadId: this.options.callerThreadId, hostId: 'local', turnId: 'dog-read-' + randomUUID(), callId: 'dog-read-' + randomUUID() }) as { success?: boolean; contentItems?: Array<{ type: string; text?: string }> };
    if (raw?.success !== true || !Array.isArray(raw.contentItems)) throw new ReadError('PROVIDER_UNAVAILABLE', '桌面只读工具返回失败');
    const texts = raw.contentItems.filter(item => item.type === 'inputText');
    if (texts.length !== 1 || typeof texts[0]!.text !== 'string') throw new ReadError('PROVIDER_SCHEMA_UNSUPPORTED', '桌面只读结果结构不兼容');
    try { return JSON.parse(texts[0]!.text); } catch { throw new ReadError('PROVIDER_SCHEMA_UNSUPPORTED', '桌面只读结果不是 JSON'); }
  }
  private disconnect(socket: Socket, error: Error) {
    if (socket !== this.socket) return;
    this.socket = undefined; this.tools.clear(); this.buffer = Buffer.alloc(0); socket.destroy();
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); } this.pending.clear();
  }
  close() { this.stopped = true; if (this.socket) this.disconnect(this.socket, new ReadError('APP_STOPPING', '只读连接已关闭')); }
}
