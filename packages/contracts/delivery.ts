import {z} from 'zod';
const id=z.object({id:z.string().uuid()}).strict(),empty=z.object({}).strict(),revision=z.number().int().positive();
export const deliveryDefinitions=[
 {operation:'threads.send',command:['threads','send'],tool:'threads_send',description:'明确单次发送，复用持久意图、目标互斥与核对；禁止绕过托管。',input:z.object({threadRef:z.object({connectionId:z.string().uuid(),threadId:z.string().uuid()}).strict(),prompt:z.string().trim().min(1).max(10000),connectionRevision:revision,expectedLatestTurnId:z.string().min(1).max(200).nullable(),confirm:z.literal(true)}).strict(),scope:'messages.send',readOnly:false},
 {operation:'attempts.list',command:['attempts','list'],tool:'attempts_list',description:'读取持久投递摘要，不返回正文或 marker。',input:z.object({taskId:z.string().uuid().optional(),limit:z.number().int().min(1).max(200).default(50),cursor:z.string().max(2000).optional()}).strict(),scope:'read',readOnly:true},
 {operation:'attempts.get',command:['attempts','get'],tool:'attempts_get',description:'分别读取提交、回执、轮次事实及槽位。',input:id,scope:'read',readOnly:true},
 {operation:'attempts.reconcile',command:['attempts','reconcile'],tool:'attempts_reconcile',description:'只核对原投递，不补发。',input:id,scope:'messages.send',readOnly:false},
 {operation:'tasks.reconcile',command:['tasks','reconcile'],tool:'tasks_reconcile',description:'只核对原任务投递，不增加新意图。',input:id,scope:'tasks.manage',readOnly:false},
 {operation:'tasks.inspect',command:['tasks','inspect'],tool:'tasks_inspect',description:'只读任务阻断诊断，不推进调度。',input:id,scope:'read',readOnly:true},
 {operation:'queue.get',command:['queue','get'],tool:'queue_get',description:'读取队列、占槽与候选顺序。',input:empty,scope:'read',readOnly:true},
 {operation:'queue.configure',command:['queue','configure'],tool:'queue_configure',description:'配置队列限制，不抢占已占用槽位。',input:z.object({expectedRevision:revision,enabled:z.boolean(),limit:z.number().int().min(1).max(20)}).strict(),scope:'settings.manage',readOnly:false},
 {operation:'tasks.reorder',command:['tasks','reorder'],tool:'tasks_reorder',description:'同优先级队列上下移动，使用队列修订。',input:id.extend({direction:z.enum(['up','down']),expectedQueueRevision:revision}),scope:'tasks.manage',readOnly:false},
 {operation:'scheduler.settings.get',command:['scheduler','settings','get'],tool:'scheduler_settings_get',description:'读取独立任务周期，默认关闭。',input:empty,scope:'read',readOnly:true},
 {operation:'scheduler.settings.update',command:['scheduler','settings','update'],tool:'scheduler_settings_update',description:'保存任务周期与开关，不立即派发。',input:z.object({expectedRevision:revision,enabled:z.boolean(),pollSeconds:z.number().int().min(10).max(300)}).strict(),scope:'settings.manage',readOnly:false},
 {operation:'scheduler.runNow',command:['scheduler','run-now'],tool:'scheduler_run_now',description:'明确推进一次已授权任务，可能模拟或真实投递；不提前消费卡预约。',input:empty,scope:'tasks.manage',readOnly:false},
] as const;
export const deliveryOperations=new Set<string>(deliveryDefinitions.map(x=>x.operation));
