import {z} from 'zod';
import {dailyWindowSchema} from './automation.ts';
export const notificationValues=z.object({enabled:z.boolean(),dailyWindow:dailyWindowSchema}).strict();
export const notificationDefinitions=[
 {operation:'notifications.settings.get',command:['notifications','settings','get'],tool:'notifications_settings_get',description:'读取通知开关与本机时段。',input:z.object({}).strict(),scope:'read',readOnly:true},
 {operation:'notifications.settings.update',command:['notifications','settings','update'],tool:'notifications_settings_update',description:'修订通知策略，不改变任务授权；通知不含正文。',input:z.object({expectedRevision:z.number().int().positive(),patch:notificationValues.partial().refine(x=>Object.keys(x).length>0)}).strict(),scope:'settings.manage',readOnly:false},
] as const;
export const notificationOperations=new Set<string>(notificationDefinitions.map(x=>x.operation));
