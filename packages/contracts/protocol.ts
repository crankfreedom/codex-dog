import { z } from 'zod';

declare const __DOG_BUILD_VERSION__: string;
export const version = typeof __DOG_BUILD_VERSION__ === 'string' ? __DOG_BUILD_VERSION__ : '0.6.0-g06';
export const apiVersion = '3';
export const emptyParams = z.object({}).strict();
export const sourceSelection = z.object({ source: z.enum(['fixture', 'live-readonly']), callerThreadId: z.union([z.literal(''), z.string().uuid()]), pipe: z.string().max(160).refine(value => !value || /^\\\\\.\\pipe\\codex-app-tools-[a-zA-Z0-9-]{1,100}$/.test(value)) }).strict();
export const sourceConfigureParams = sourceSelection.extend({ expectedRevision: z.number().int().positive() }).refine(value => value.source !== 'live-readonly' || !!value.callerThreadId, '真实模式必须明确调用会话');
export const quitParams = z.object({ expectedInstanceId: z.string().uuid(), confirm: z.literal(true) }).strict();
export const describeParams = z.object({ operation: z.string().min(1).max(100) }).strict();
export const scopeSchema = z.enum(['read', 'access.manage', 'app.manage']);
export type Scope = z.infer<typeof scopeSchema>;
export const credentialSchema = z.object({ clientId: z.string().uuid(), secret: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type Credential = z.infer<typeof credentialSchema>;
export const accessRequestParams = z.object({ clientLabel: z.string().trim().min(1).max(80), requestedScopes: z.array(scopeSchema).min(1).max(3) }).strict();
export const accessGrantParams = z.object({ id: z.string().uuid(), expectedRevision: z.number().int().positive(), code: z.string().regex(/^[A-F0-9]{6}$/), scopes: z.array(scopeSchema).min(1).max(3), expiresAt: z.string().datetime({ offset: true }).nullable().default(null) }).strict();
export const accessRevokeParams = z.object({ id: z.string().uuid(), expectedRevision: z.number().int().positive() }).strict();
export const threadRefParams = z.object({ connectionId: z.string().uuid(), threadId: z.string().uuid() }).strict();
export const threadListParams = z.object({ connectionId: z.string().uuid(), limit: z.number().int().min(1).max(50).default(20), cursor: z.string().min(1).max(2000).optional(), archived: z.boolean().default(false) }).strict();
export const updateDownloadParams = z.object({ candidateId: z.string().uuid(), expectedVersion: z.string().min(1).max(80) }).strict();
export const updateInstallParams = z.object({ artifactId: z.string().uuid(), expectedVersion: z.string().min(1).max(80), confirm: z.literal(true) }).strict();
export const liveOperations = new Set(['connections.discover', 'connections.get', 'quota.refresh', 'threads.list', 'threads.get', 'goals.get']);
export const workerOperations = new Set(['quota.get', ...liveOperations]);
export const definitions = [
  { operation: 'connections.configuration', command: ['connections', 'configuration'], tool: 'connections_configuration', description: '读取当前和下次启动的显式来源选择。', input: emptyParams, scope: 'read', readOnly: true },
  { operation: 'connections.configure', command: ['connections', 'configure'], tool: 'connections_configure', description: '保存下次启动的来源选择，当前进程不自动切换；需要应用管理权限。', input: sourceConfigureParams, scope: 'app.manage', readOnly: false },
  { operation: 'desktop.show', command: ['desktop', 'show'], tool: 'desktop_show', description: '显示本应用窗口，应用离线时不拉起。', input: emptyParams, scope: 'read', readOnly: true },
  { operation: 'app.quit', command: ['app', 'quit'], tool: 'app_quit', description: '明确退出指定应用实例并停止本机接口及子进程。', input: quitParams, scope: 'app.manage', readOnly: false },
  { operation: 'quota.get', command: ['quota', 'get'], tool: 'quota_get', description: '读取当前模式额度观察，明确来源、未知与过期状态。', input: emptyParams, scope: 'read', readOnly: true },
  { operation: 'app.status', command: ['app', 'status'], tool: 'app_status', description: '读取主应用、心跳与业务进程恢复状态。', input: emptyParams, scope: 'read', readOnly: true },
  { operation: 'app.version', command: ['app', 'version'], tool: 'app_version', description: '读取正在运行的主应用版本。', input: emptyParams, scope: 'read', readOnly: true },
  { operation: 'capabilities.list', command: ['capabilities', 'list'], tool: 'capabilities_list', description: '列出已实现能力，不将规划能力冒充已实现。', input: emptyParams, scope: 'read', readOnly: true },
  { operation: 'capabilities.describe', command: ['capabilities', 'describe'], tool: 'capabilities_describe', description: '读取指定能力的契约。', input: describeParams, scope: 'read', readOnly: true },
  { operation: 'connections.discover', command: ['connections', 'discover'], tool: 'connections_discover', description: '只读发现本机 Codex 候选，不猜选多个实例。', input: emptyParams, scope: 'read', readOnly: true },
  { operation: 'connections.get', command: ['connections', 'get'], tool: 'connections_get', description: '读取当前只读连接、身份修订及可用状态。', input: emptyParams, scope: 'read', readOnly: true },
  { operation: 'quota.refresh', command: ['quota', 'refresh'], tool: 'quota_refresh', description: '只读刷新真实额度，不推进调度或消费卡片。', input: emptyParams, scope: 'read', readOnly: true },
  { operation: 'threads.list', command: ['threads', 'list'], tool: 'threads_list', description: '分页读取本机 Codex 会话身份及状态，不含正文或摘要。', input: threadListParams, scope: 'read', readOnly: true },
  { operation: 'threads.get', command: ['threads', 'get'], tool: 'threads_get', description: '读取会话和最新轮次状态，核对前后 Goal，不含正文。', input: threadRefParams, scope: 'read', readOnly: true },
  { operation: 'goals.get', command: ['goals', 'get'], tool: 'goals_get', description: '只读 Goal 身份及状态，明确未知和无当前 Goal。', input: threadRefParams, scope: 'read', readOnly: true },
  { operation: 'updates.status', command: ['updates', 'status'], tool: 'updates_status', description: '读取当前发行通道的固定 GitHub 更新状态与持久操作结果。', input: emptyParams, scope: 'read', readOnly: true },
  { operation: 'updates.check', command: ['updates', 'check'], tool: 'updates_check', description: '检查固定更新仓库，不自动下载或安装。', input: emptyParams, scope: 'read', readOnly: true },
  { operation: 'updates.download', command: ['updates', 'download'], tool: 'updates_download', description: '下载固定候选，返回持久操作 ID。', input: updateDownloadParams, scope: 'app.manage', readOnly: false },
  { operation: 'updates.install', command: ['updates', 'install'], tool: 'updates_install', description: '明确确认安装，先检查 CLI 占用、备份并清理进程。', input: updateInstallParams, scope: 'app.manage', readOnly: false },
  { operation: 'access.request', command: ['access', 'request'], tool: 'access_request', description: '申请授权；只创建待配对记录，不能自授权限。', input: accessRequestParams, scope: 'pairing', readOnly: false },
  { operation: 'access.list', command: ['access', 'list'], tool: 'access_list', description: '查看客户端与配对申请，不包含凭据。', input: emptyParams, scope: 'access.manage', readOnly: true },
  { operation: 'access.grant', command: ['access', 'grant'], tool: 'access_grant', description: '明确批准指定申请与权限，须管理权限。', input: accessGrantParams, scope: 'access.manage', readOnly: false },
  { operation: 'access.revoke', command: ['access', 'revoke'], tool: 'access_revoke', description: '撤销客户端授权，后续请求及未返回读取立即复核。', input: accessRevokeParams, scope: 'access.manage', readOnly: false },
] as const;
export type OperationName = (typeof definitions)[number]['operation'];
export const requestSchema = z.object({ apiVersion: z.literal(apiVersion), requestId: z.string().min(1).max(100), operation: z.string().min(1).max(100), params: z.record(z.string(), z.unknown()), idempotencyKey: z.string().min(1).max(100).optional() }).strict();
export type Request = z.infer<typeof requestSchema>;
export const responseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.record(z.string(), z.unknown()), meta: z.object({ apiVersion: z.literal(apiVersion), requestId: z.string(), source: z.enum(['fixture', 'local', 'live']), runtimeId: z.string(), handlerInstanceId: z.string(), workerPid: z.number().int().positive().nullable() }).strict() }).strict(),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }).strict(), meta: z.object({ apiVersion: z.literal(apiVersion), requestId: z.string() }).strict() }).strict(),
]);
export type Response = z.infer<typeof responseSchema>;
export const wireSchema = z.object({ credential: credentialSchema.optional(), request: requestSchema }).strict();
export function failure(code: string, message: string, requestId = 'unassigned'): Response {
  return { ok: false, error: { code, message }, meta: { apiVersion, requestId } };
}
export function exitCode(result: Response): number {
  if (result.ok) return 0;
  if (['INVALID_ARGUMENT', 'INPUT_TOO_LARGE'].includes(result.error.code)) return 2;
  if (['PERMISSION_DENIED', 'AUTH_REQUIRED', 'AUTH_REVOKED'].includes(result.error.code)) return 3;
  if (['APP_NOT_READY', 'APP_STOPPING', 'REVISION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'PAIRING_EXPIRED', 'CLIENT_LIMIT', 'CONNECTION_IDENTITY_CHANGED', 'TARGET_IDENTITY_MISMATCH', 'GOAL_IDENTITY_CHANGED', 'UPDATE_BUSY', 'UPDATE_VERSION_REJECTED', 'CLI_IN_USE', 'UPDATE_HISTORY_FULL'].includes(result.error.code)) return 4;
  if (['APP_NOT_RUNNING', 'CAPABILITY_UNSUPPORTED', 'READ_TIMEOUT', 'PROTOCOL_INCOMPATIBLE', 'PROVIDER_UNAVAILABLE', 'PROVIDER_SELECTION_REQUIRED', 'PROVIDER_SCHEMA_UNSUPPORTED', 'PROVIDER_IDENTITY_UNAVAILABLE', 'UPDATE_UNSUPPORTED', 'UPDATE_SOURCE_UNAVAILABLE', 'UPDATE_METADATA_INVALID', 'UPDATE_INTEGRITY_FAILED', 'UPDATE_SIGNATURE_INVALID', 'UPDATE_DOWNLOAD_FAILED', 'UPDATE_INSTALL_FAILED'].includes(result.error.code)) return 5;
  if (result.error.code === 'OPERATION_UNCERTAIN') return 6;
  return 7;
}
export function describe(operation: string) {
  const definition = definitions.find(item => item.operation === operation);
  return definition ? { operation: definition.operation, command: definition.command, mcpTool: definition.tool, description: definition.description, inputSchema: z.toJSONSchema(definition.input), scopes: [definition.scope], readOnly: definition.readOnly, available: true } : undefined;
}
