import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { apiVersion, definitions, describe, exitCode, failure, version,mcpInputSchema } from '../../packages/contracts/protocol.ts';
import type { Response,Request } from '../../packages/contracts/protocol.ts';
import { readStaticHelp } from '../../packages/contracts/help.ts';
import { invokeHost, locations, requestLimit } from '../../packages/infrastructure/local-transport.ts';
async function invoke(request:Request,profile:string,timeout:number,client:string):Promise<Response>{
  if(request.operation==='help.get'||request.operation==='help.search')return {ok:true,data:readStaticHelp(request.operation,request.params),meta:{apiVersion,requestId:request.requestId,source:'local',runtimeId:'package-static',handlerInstanceId:'help-static',workerPid:null}};
  return invokeHost(request,profile,timeout,client);
}

async function serveMcp(profile: string, timeout: number, clientName: string) {
  const server = new Server({ name: 'codex-dog', version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: definitions.map(definition => ({ name: definition.tool, description: definition.description,
    inputSchema:mcpInputSchema(definition.operation)!, annotations: { readOnlyHint: definition.readOnly, idempotentHint: true, openWorldHint: false } })) }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const definition = definitions.find(d => d.tool === request.params.name);
    const args = { ...(request.params.arguments ?? {}) }; const key = args.idempotencyKey; delete args.idempotencyKey;
    const validated=definition?.input.safeParse(args);
    const result = definition ? !validated?.success?failure('INVALID_ARGUMENT','参数不符合能力契约'):await invoke({ apiVersion, requestId: randomUUID(), operation: definition.operation, params: validated.data, ...(typeof key === 'string' ? { idempotencyKey: key } : {}) }, profile, timeout, clientName)
      : failure('CAPABILITY_UNSUPPORTED', '尚未实现该工具');
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result, isError: !result.ok };
  });
  await server.connect(new StdioServerTransport());
}
async function inputJson(path: string): Promise<unknown> {
  if (path !== '-') {
    if ((await stat(path)).size > requestLimit - 1024) throw new Error('INPUT_TOO_LARGE');
    return JSON.parse(await readFile(path, 'utf8'));
  }
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of process.stdin) { const data = Buffer.from(chunk); size += data.length; if (size > requestLimit - 1024) throw new Error('INPUT_TOO_LARGE'); chunks.push(data); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--version') { console.log(version); return; }
  if (!args.length || args.includes('--help')) {
    console.log('Codex Dog：只读桌面；业务来源以正在运行的应用为准。先启动并配对；help get/search 为包内离线说明。\n' + definitions.map(d => `  ${d.command.join(' ')} --json`).join('\n') + '\n  mcp serve\n参数：--profile NAME --client NAME --idempotency-key KEY --timeout-ms 1..120000 --input FILE|- --operation NAME --section NAME --topic NAME --query TEXT --id UUID'); return;
  }
  const json = args.includes('--json');
  const options = new Map<string, string>(); const positional: string[] = [];
  let result: Response;
  try {
    for (let i = 0; i < args.length; i++) {
      const item = args[i]!;
      if (item === '--json') continue;
      if (!item.startsWith('--')) { positional.push(item); continue; }
      if (!['--profile', '--client', '--idempotency-key', '--timeout-ms', '--input', '--operation','--section','--topic','--query','--id'].includes(item) || options.has(item) || !args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error('INVALID_ARGUMENT');
      options.set(item, args[++i]!);
    }
    const profile = options.get('--profile') ?? 'g02'; locations(profile);
    const clientName = options.get('--client') ?? (positional.join(' ') === 'mcp serve' ? 'mcp' : 'cli');
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(clientName)) throw new Error('INVALID_ARGUMENT');
    const timeout = Number(options.get('--timeout-ms') ?? 30000);
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120000) throw new Error('INVALID_ARGUMENT');
    if (positional.join(' ') === 'mcp serve') {
      if (json || ['--input','--operation','--idempotency-key','--section','--topic','--query','--id'].some(key=>options.has(key))) throw new Error('INVALID_ARGUMENT');
      await serveMcp(profile, timeout, clientName); return;
    }
    const definition = definitions.find(d => d.command.join(' ') === positional.join(' '));
    if (!definition) { result = failure('CAPABILITY_UNSUPPORTED', '当前版本尚未实现该命令，请运行 --help'); }
    else {
      const named:{[key:string]:string}={'--operation':'operation','--section':'section','--topic':'topic','--query':'query','--id':'id'};
      const permitted:Record<string,string[]>={'capabilities.describe':['--operation'],'settings.get':['--section'],'help.get':['--topic'],'help.search':['--query'],'operations.get':['--id'],'operations.cancel':['--id']};
      const selected=Object.keys(named).filter(key=>options.has(key));if(selected.some(key=>!permitted[definition.operation]?.includes(key))||options.has('--input')&&selected.length)throw new Error('INVALID_ARGUMENT');
      const params = options.has('--input') ? await inputJson(options.get('--input')!) : selected.length?Object.fromEntries(selected.map(key=>[named[key],options.get(key)])):definition.operation === 'access.request' ? { clientLabel: clientName, requestedScopes: ['read'] } : {};
      const validated = definition.input.safeParse(params);
      if (!validated.success) throw new Error('INVALID_ARGUMENT');
      result = await invoke({ apiVersion, requestId: randomUUID(), operation: definition.operation, params: validated.data, ...(options.has('--idempotency-key') ? { idempotencyKey: options.get('--idempotency-key') } : {}) }, profile, timeout, clientName);
    }
  } catch (error) { result = failure((error as Error).message === 'INPUT_TOO_LARGE' ? 'INPUT_TOO_LARGE' : 'INVALID_ARGUMENT', '参数或输入 JSON 无效'); }
  if (json) console.log(JSON.stringify(result));
  else if (result.ok) console.log(JSON.stringify(result.data, null, 2));
  else console.error(`${result.error.code}: ${result.error.message}`);
  process.exitCode = exitCode(result);
}
void main().catch(() => { console.error('Codex Dog 客户端启动失败'); process.exitCode = 7; });
