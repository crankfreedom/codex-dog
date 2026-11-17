import { z } from 'zod';

const empty = z.object({}).strict();
export const resourceId = z.string().uuid();
const revision = z.number().int().positive();
const prompt = z.string().trim().min(1).max(10000);
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const dailyWindowSchema = z.union([z.object({allDay:z.literal(true)}).strict(),z.object({allDay:z.literal(false),start:clock,end:clock}).strict().refine(x=>x.start!==x.end)]);
export const taskConfigSchema = z.object({prompt,mode:z.enum(['auto','observe']).default('observe'),maxResumes:z.number().int().min(1).max(20).default(3),priority:z.enum(['high','normal','low']).default('normal'),expiresAt:z.string().datetime({offset:true}).nullable().default(null),dailyWindow:dailyWindowSchema.default({allDay:true})}).strict();
export type TaskConfig = z.infer<typeof taskConfigSchema>;
const ref = z.object({connectionId:resourceId,threadId:resourceId}).strict();
const authorization = z.object({allowAutomaticSend:z.literal(true),connectionRevision:revision,expectedLatestTurnId:z.string().min(1).max(200).nullable(),expectedGoalId:z.string().min(1).max(200).nullable()}).strict();
const id = z.object({id:resourceId}).strict();
const readId = id.extend({includeContent:z.boolean().default(false)});
const page = z.object({limit:z.number().int().min(1).max(200).default(50),cursor:z.string().min(1).max(2000).optional(),reason:z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/).optional()}).strict();
export const automationDefinitions = [
  {operation:'templates.list',command:['templates','list'],tool:'templates_list',description:'读取模板摘要，正文单独授权。',input:page,scope:'read',readOnly:true},
  {operation:'templates.get',command:['templates','get'],tool:'templates_get',description:'读取模板；正文需要 content.read。',input:readId,scope:'read',readOnly:true},
  {operation:'templates.create',command:['templates','create'],tool:'templates_create',description:'创建或复制提示词模板，不追改既有任务。',input:z.object({name:z.string().trim().min(1).max(80),body:prompt.optional(),copyOfId:resourceId.optional(),expectedSourceRevision:revision.optional()}).strict().refine(x=>!!x.body!==!!x.copyOfId&&(!x.copyOfId||!!x.expectedSourceRevision)),scope:'tasks.manage',readOnly:false},
  {operation:'templates.update',command:['templates','update'],tool:'templates_update',description:'修订指定模板，不追改任务。',input:id.extend({expectedRevision:revision,patch:z.object({name:z.string().trim().min(1).max(80).optional(),body:prompt.optional()}).strict().refine(x=>Object.keys(x).length>0)}),scope:'tasks.manage',readOnly:false},
  {operation:'templates.delete',command:['templates','delete'],tool:'templates_delete',description:'删除指定修订的模板，保留任务快照。',input:id.extend({expectedRevision:revision}),scope:'tasks.manage',readOnly:false},
  {operation:'templates.setDefault',command:['templates','set-default'],tool:'templates_set_default',description:'设置指定修订为默认模板。',input:id.extend({expectedRevision:revision}),scope:'tasks.manage',readOnly:false},
  {operation:'tasks.create',command:['tasks','create'],tool:'tasks_create',description:'创建独立任务快照，默认暂停、仅观察；开启自动模式需要另行授权。',input:taskConfigSchema.omit({prompt:true}).extend({threadRef:ref,prompt:prompt.optional(),templateRef:z.object({templateId:resourceId,revision}).strict().optional(),enabled:z.boolean().default(false),authorization:authorization.optional()}).refine(x=>!!x.prompt!==!!x.templateRef),scope:'tasks.manage',readOnly:false},
  {operation:'tasks.get',command:['tasks','get'],tool:'tasks_get',description:'读取任务；提示词需要 content.read。',input:readId,scope:'read',readOnly:true},
  {operation:'tasks.list',command:['tasks','list'],tool:'tasks_list',description:'分页读取当前托管任务摘要。',input:page,scope:'read',readOnly:true},
  {operation:'tasks.update',command:['tasks','update'],tool:'tasks_update',description:'仅暂停且无未决投递时修订；保存后保持暂停、累计次数不重置。',input:id.extend({expectedRevision:revision,patch:taskConfigSchema.partial().refine(x=>Object.keys(x).length>0)}),scope:'tasks.manage',readOnly:false},
  {operation:'tasks.enable',command:['tasks','enable'],tool:'tasks_enable',description:'核验当前修订并绑定本次目标授权；重启可明确重绑当前连接，原目标和累计次数保留。',input:id.extend({confirmedRevision:revision,connectionId:resourceId.optional(),authorization:authorization.optional()}),scope:'tasks.manage',readOnly:false},
  {operation:'tasks.pause',command:['tasks','pause'],tool:'tasks_pause',description:'暂停后续派发，保留已提交或不确定的投递。',input:id,scope:'tasks.manage',readOnly:false},
  {operation:'tasks.remove',command:['tasks','remove'],tool:'tasks_remove',description:'归档暂停且无未决投递的任务。',input:id.extend({expectedRevision:revision}),scope:'tasks.manage',readOnly:false},
  {operation:'tasks.policy.get',command:['tasks','policy','get'],tool:'tasks_policy_get',description:'读取任务策略、累计次数和授权摘要。',input:id,scope:'read',readOnly:true},
  {operation:'tasks.revisions.list',command:['tasks','revisions','list'],tool:'tasks_revisions_list',description:'读取不可变修订元数据，不包含历史正文。',input:id.extend({limit:z.number().int().min(1).max(200).default(50),cursor:z.string().max(2000).optional()}),scope:'read',readOnly:true},
  {operation:'archives.list',command:['archives','list'],tool:'archives_list',description:'读取已归档任务摘要。',input:page,scope:'read',readOnly:true},
  {operation:'archives.get',command:['archives','get'],tool:'archives_get',description:'读取归档任务及原累计次数，正文另需授权。',input:readId,scope:'read',readOnly:true},
  {operation:'timelines.get',command:['timelines','get'],tool:'timelines_get',description:'读取本任务真实发生的脱敏事件时间线。',input:id.extend({limit:z.number().int().min(1).max(200).default(50),cursor:z.string().max(2000).optional()}),scope:'read',readOnly:true},
] as const;
export const automationOperations = new Set<string>(automationDefinitions.map(x=>x.operation));
