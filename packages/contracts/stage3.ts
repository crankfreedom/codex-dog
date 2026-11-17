import { z } from 'zod';

export const themeIds = ['solid-1','solid-2','solid-3','solid-4','solid-5','solid-6','solid-7','solid-8','solid-9','solid-10','gradient-1','gradient-2','gradient-3','gradient-4','gradient-5','gradient-6','gradient-7','gradient-8','gradient-9','gradient-10'] as const;
export const appearanceSchema = z.object({ theme: z.enum(themeIds), font: z.enum(['system','sans','serif','mono']), density: z.enum(['comfortable','compact']), contrast: z.enum(['standard','high']), titleSize: z.number().int().min(24).max(40), sectionSize: z.number().int().min(16).max(30), bodySize: z.number().int().min(12).max(24), captionSize: z.number().int().min(11).max(18), navSize: z.number().int().min(13).max(20), lineHeight: z.number().min(1.4).max(2.2) }).strict();
export type Appearance = z.infer<typeof appearanceSchema>;
export const defaultAppearance: Appearance = { theme:'solid-1',font:'system',density:'comfortable',contrast:'standard',titleSize:28,sectionSize:18,bodySize:14,captionSize:12,navSize:14,lineHeight:1.7 };
export const monitoringSchema = z.object({ autoRefresh: z.boolean(), quotaIntervalSeconds: z.number().int().min(10).max(3600) }).strict();
export type Monitoring = z.infer<typeof monitoringSchema>;
export const defaultMonitoring: Monitoring = { autoRefresh:false,quotaIntervalSeconds:600 };
const nonempty = (value: object) => Object.keys(value).length > 0;
export const appearancePatch = appearanceSchema.partial().refine(nonempty);
export const monitoringPatch = monitoringSchema.partial().refine(nonempty);
const revision = z.number().int().positive();
export const appearanceUpdate = z.object({ expectedRevision:revision,patch:appearancePatch }).strict();
export const monitoringUpdate = z.object({ expectedRevision:revision,patch:monitoringPatch }).strict();
export const settingsUpdate = z.discriminatedUnion('section',[appearanceUpdate.extend({section:z.literal('appearance')}),monitoringUpdate.extend({section:z.literal('monitoring')})]);
export const settingsGet = z.object({ section:z.enum(['appearance','monitoring']) }).strict();
export const previewInput = appearanceUpdate.extend({ previewId:z.string().uuid().optional() });
export const cancelPreviewInput = z.object({ previewId:z.string().uuid() }).strict();
export const eventKinds = ['runtime.started','runtime.stopping','settings.updated','export.completed','export.cancelled','export.failed'] as const;
export const eventReasons = ['fixture','live-readonly','appearance','monitoring','completed','cancelled','AUTH_REVOKED','APP_STOPPING','PROCESS_INTERRUPTED','STORAGE_FAILURE','EXPORT_TARGET_EXISTS'] as const;
export const historyFilter = { from:z.string().datetime({offset:true}).optional(),to:z.string().datetime({offset:true}).optional(),type:z.enum(eventKinds).optional(),reason:z.enum(eventReasons).optional() };
export const eventQuery = z.object({...historyFilter,limit:z.number().int().min(1).max(200).default(50),cursor:z.string().min(1).max(1500).optional()}).strict().refine(v=>!v.from||!v.to||Date.parse(v.from)<=Date.parse(v.to));
export const eventExport = z.object({...historyFilter,limit:z.number().int().min(1).max(20000).default(20000),output:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\.jsonl$/).optional()}).strict().refine(v=>!v.from||!v.to||Date.parse(v.from)<=Date.parse(v.to));
export const operationRef = z.object({id:z.string().uuid()}).strict();
const empty = z.object({}).strict();
export const diagnosticInput = z.object({ threadRef:z.object({connectionId:z.string().uuid(),threadId:z.string().uuid()}).strict().optional() }).strict();
export const helpGet = z.object({ topic:z.enum(['overview','sources','pairing','quota','threads','settings','diagnostics','history','limits']).default('overview') }).strict();
export const helpSearch = z.object({ query:z.string().trim().min(1).max(80),limit:z.number().int().min(1).max(20).default(10) }).strict();
export const stage3Definitions = [
  {operation:'settings.get',command:['settings','get'],tool:'settings_get',description:'读取已实现的本应用设置分区、修订和允许字段。',input:settingsGet,scope:'read',readOnly:true},
  {operation:'settings.update',command:['settings','update'],tool:'settings_update',description:'按分区保存本应用设置，持久幂等且不改变真实任务。',input:settingsUpdate,scope:'settings.manage',readOnly:false},
  {operation:'quota.policy.get',command:['quota','policy','get'],tool:'quota_policy_get',description:'读取独立额度只读刷新策略。',input:empty,scope:'read',readOnly:true},
  {operation:'quota.policy.update',command:['quota','policy','update'],tool:'quota_policy_update',description:'保存额度只读刷新策略，不启动任务调度。',input:monitoringUpdate,scope:'settings.manage',readOnly:false},
  {operation:'appearance.get',command:['appearance','get'],tool:'appearance_get',description:'读取已保存外观和修订。',input:empty,scope:'read',readOnly:true},
  {operation:'appearance.update',command:['appearance','update'],tool:'appearance_update',description:'保存白名单外观，不覆盖其他设置。',input:appearanceUpdate,scope:'settings.manage',readOnly:false},
  {operation:'appearance.presets',command:['appearance','presets'],tool:'appearance_presets',description:'读取默认、阅读预设和二十种主题白名单。',input:empty,scope:'read',readOnly:true},
  {operation:'appearance.preview',command:['appearance','preview'],tool:'appearance_preview',description:'仅在本应用可见窗口临时预览，离页/隐藏撤销，不保存。',input:previewInput,scope:'settings.manage',readOnly:false},
  {operation:'appearance.cancelPreview',command:['appearance','cancel-preview'],tool:'appearance_cancel_preview',description:'撤销自己窗口的临时预览，恢复已保存外观。',input:cancelPreviewInput,scope:'settings.manage',readOnly:false},
  {operation:'diagnostics.run',command:['diagnostics','run'],tool:'diagnostics_run',description:'读取当前连接、额度快照、存储和明确目标的诊断，不刷新额度或推进调度。',input:diagnosticInput,scope:'read',readOnly:true},
  {operation:'events.query',command:['events','query'],tool:'events_query',description:'按固定边界查询本应用实际脱敏历史，游标绑定查询条件。',input:eventQuery,scope:'read',readOnly:true},
  {operation:'events.export',command:['events','export'],tool:'events_export',description:'在固定 exports 目录导出有界 JSONL，不覆盖文件，支持取消。',input:eventExport,scope:'read',readOnly:false},
  {operation:'operations.get',command:['operations','get'],tool:'operations_get',description:'查询授权范围内的历史导出操作，不透传模块内部状态。',input:operationRef,scope:'read',readOnly:true},
  {operation:'operations.list',command:['operations','list'],tool:'operations_list',description:'查询本人导出；可信桌面及 app.manage 可核对本机全部导出。',input:z.object({limit:z.number().int().min(1).max(100).default(20)}).strict(),scope:'read',readOnly:true},
  {operation:'operations.cancel',command:['operations','cancel'],tool:'operations_cancel',description:'取消授权范围内的导出；已完成操作不能撤回。',input:operationRef,scope:'read',readOnly:false},
  {operation:'desktop.status',command:['desktop','status'],tool:'desktop_status',description:'读取本应用窗口、托盘及平台支持状态。',input:empty,scope:'read',readOnly:true},
  {operation:'desktop.openDataDirectory',command:['desktop','open-data-directory'],tool:'desktop_open_data_directory',description:'仅打开本应用当前 profile 的固定目录。',input:empty,scope:'app.manage',readOnly:false},
  {operation:'help.get',command:['help','get'],tool:'help_get',description:'读取包内静态说明；离线可用，不返回业务状态。',input:helpGet,scope:'public',readOnly:true},
  {operation:'help.search',command:['help','search'],tool:'help_search',description:'搜索包内静态说明；离线可用。',input:helpSearch,scope:'public',readOnly:true},
] as const;
export const stage3WorkerOperations = new Set<string>(stage3Definitions.filter(d=>!d.operation.startsWith('help.')&&!d.operation.startsWith('desktop.')&&!['appearance.preview','appearance.cancelPreview'].includes(d.operation)).map(d=>d.operation));
const settingOutput=z.discriminatedUnion('section',[z.object({section:z.literal('appearance'),revision,values:appearanceSchema}).strict(),z.object({section:z.literal('monitoring'),revision,values:monitoringSchema}).strict()]);
const historyEventOutput=z.object({sequence:revision,at:z.string().datetime(),type:z.enum(eventKinds),reason:z.enum(eventReasons),source:z.literal('local'),revision:revision.nullable()}).strict();
const operationOutput=z.object({id:z.string().uuid(),kind:z.literal('events.export'),state:z.enum(['accepted','running','succeeded','failed','cancelled']),createdAt:z.string().datetime(),updatedAt:z.string().datetime(),boundary:z.number().int().nonnegative(),written:z.number().int().nonnegative(),fileName:z.string().nullable(),error:z.string().max(80).nullable(),cancelRequested:z.boolean()}).strict();
const topicOutput=z.object({id:z.string(),title:z.string(),text:z.string()}).strict();
const diagnosticOutput=z.object({status:z.enum(['passed','blocked','unknown']),checks:z.array(z.object({id:z.string(),status:z.enum(['passed','blocked','unknown','not_checked']),reason:z.string().max(100),source:z.enum(['local','fixture','live'])}).strict()),mode:z.enum(['fixture','live-readonly']),source:z.enum(['fixture','live']),observedAt:z.string().datetime(),stale:z.literal(false),completionConfirmed:z.literal(false),readOnly:z.literal(true),hostState:z.string().optional()}).strict();
export const stage3Outputs:Record<string,z.ZodType>={
  'settings.get':settingOutput,'settings.update':settingOutput,'appearance.update':settingOutput,
  'appearance.get':z.object({section:z.literal('appearance'),revision,values:appearanceSchema,preview:z.object({id:z.string().uuid(),values:appearanceSchema}).strict().nullable().optional()}).strict(),
  'quota.policy.get':z.object({section:z.literal('monitoring'),revision,values:monitoringSchema,runtime:z.object({enabled:z.boolean(),intervalSeconds:z.number(),nextCheckAt:z.string().datetime().nullable(),lastAttemptAt:z.string().datetime().nullable(),lastResult:z.string().nullable()}).strict()}).strict(),
  'quota.policy.update':settingOutput,
  'appearance.presets':z.object({defaults:appearanceSchema,monitoringDefaults:monitoringSchema,themes:z.array(z.object({id:z.enum(themeIds),label:z.string()}).strict()).length(20),presets:z.array(z.object({id:z.string(),label:z.string(),values:appearanceSchema}).strict())}).strict(),
  'appearance.preview':z.object({previewId:z.string().uuid(),values:appearanceSchema,savedRevision:revision,active:z.boolean()}).strict(),
  'appearance.cancelPreview':z.object({cancelled:z.literal(true),previewId:z.string().uuid()}).strict(),
  'diagnostics.run':diagnosticOutput,
  'events.query':z.object({items:z.array(historyEventOutput).max(200),boundary:z.number().int().nonnegative(),nextCursor:z.string().nullable(),source:z.literal('local'),observedAt:z.string().datetime(),stale:z.literal(false)}).strict(),
  'events.export':operationOutput,'operations.get':operationOutput,'operations.cancel':operationOutput,'operations.list':z.object({items:z.array(operationOutput).max(100)}).strict(),
  'desktop.status':z.object({windowVisible:z.boolean(),trayAvailable:z.boolean(),supported:z.literal(true)}).strict(),'desktop.openDataDirectory':z.object({opened:z.literal(true)}).strict(),
  'help.get':z.object({topic:topicOutput,source:z.literal('package-static'),hostStateIncluded:z.literal(false)}).strict(),
  'help.search':z.object({items:z.array(topicOutput),source:z.literal('package-static'),hostStateIncluded:z.literal(false)}).strict(),
};
