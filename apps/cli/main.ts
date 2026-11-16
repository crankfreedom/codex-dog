import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { apiVersion, definitions, describe, exitCode, failure, version } from '../../packages/contracts/protocol.ts';
import type { Response } from '../../packages/contracts/protocol.ts';
import { invokeHost, locations, requestLimit } from '../../packages/infrastructure/local-transport.ts';

async function serveMcp(profile: string, timeout: number, clientName: string) {
  const server = new Server({ name: 'codex-dog', version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: definitions.map(definition => ({ name: definition.tool, description: definition.description,
    inputSchema: { ...describe(definition.operation)!.inputSchema, properties: { ...(describe(definition.operation)!.inputSchema.properties ?? {}), ...(definition.readOnly ? {} : { idempotencyKey: { type: 'string', minLength: 1, maxLength: 100 } }) } } as { type: 'object'; [key: string]: unknown }, annotations: { readOnlyHint: definition.readOnly, idempotentHint: true, openWorldHint: false } })) }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const definition = definitions.find(d => d.tool === request.params.name);
    const args = { ...(request.params.arguments ?? {}) }; const key = args.idempotencyKey; delete args.idempotencyKey;
    const result = definition ? await invokeHost({ apiVersion, requestId: randomUUID(), operation: definition.operation, params: args, ...(typeof key === 'string' ? { idempotencyKey: key } : {}) }, profile, timeout, clientName)
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
    console.log('Codex Dog：模拟业务数据；先启动应用并完成配对。\n' + definitions.map(d => `  ${d.command.join(' ')} --json`).join('\n') + '\n  mcp serve\n参数：--profile NAME --client NAME --idempotency-key KEY --timeout-ms 1..120000 --input FILE|- --operation NAME'); return;
  }
  const json = args.includes('--json');
  const options = new Map<string, string>(); const positional: string[] = [];
  let result: Response;
  try {
    for (let i = 0; i < args.length; i++) {
      const item = args[i]!;
      if (item === '--json') continue;
      if (!item.startsWith('--')) { positional.push(item); continue; }
      if (!['--profile', '--client', '--idempotency-key', '--timeout-ms', '--input', '--operation'].includes(item) || options.has(item) || !args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error('INVALID_ARGUMENT');
      options.set(item, args[++i]!);
    }
    const profile = options.get('--profile') ?? 'g02'; locations(profile);
    const clientName = options.get('--client') ?? (positional.join(' ') === 'mcp serve' ? 'mcp' : 'cli');
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(clientName)) throw new Error('INVALID_ARGUMENT');
    const timeout = Number(options.get('--timeout-ms') ?? 30000);
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120000) throw new Error('INVALID_ARGUMENT');
    if (positional.join(' ') === 'mcp serve') {
      if (json || options.has('--input') || options.has('--operation') || options.has('--idempotency-key')) throw new Error('INVALID_ARGUMENT');
      await serveMcp(profile, timeout, clientName); return;
    }
    const definition = definitions.find(d => d.command.join(' ') === positional.join(' '));
    if (!definition) { result = failure('CAPABILITY_UNSUPPORTED', '当前版本尚未实现该命令，请运行 --help'); }
    else {
      if (options.has('--input') && options.has('--operation')) throw new Error('INVALID_ARGUMENT');
      const params = options.has('--input') ? await inputJson(options.get('--input')!) : options.has('--operation') ? { operation: options.get('--operation') } : definition.operation === 'access.request' ? { clientLabel: clientName, requestedScopes: ['read'] } : {};
      const validated = definition.input.safeParse(params);
      if (!validated.success) throw new Error('INVALID_ARGUMENT');
      result = await invokeHost({ apiVersion, requestId: randomUUID(), operation: definition.operation, params: validated.data, ...(options.has('--idempotency-key') ? { idempotencyKey: options.get('--idempotency-key') } : {}) }, profile, timeout, clientName);
    }
  } catch (error) { result = failure((error as Error).message === 'INPUT_TOO_LARGE' ? 'INPUT_TOO_LARGE' : 'INVALID_ARGUMENT', '参数或输入 JSON 无效'); }
  if (json) console.log(JSON.stringify(result));
  else if (result.ok) console.log(JSON.stringify(result.data, null, 2));
  else console.error(`${result.error.code}: ${result.error.message}`);
  process.exitCode = exitCode(result);
}
void main().catch(() => { console.error('Codex Dog 客户端启动失败'); process.exitCode = 7; });
