import {z} from 'zod';
import {storedTask,storedAttempt,storedAppointment} from './automation-storage.ts';
import {taskConfigSchema} from './automation.ts';
import {notificationValues} from './notifications.ts';
const revision=z.number().int().positive(),id=z.string().uuid();
const task=z.object({...storedTask.shape,...taskConfigSchema.shape,prompt:z.string().nullable(),authorization:z.object({bound:z.literal(true),connectionRevision:revision,goalId:z.string().nullable()}).strict().nullable()}).omit({config:true,owner:true,revisions:true}).strict();
const template=z.object({id,name:z.string(),body:z.string().nullable(),revision,isDefault:z.boolean(),deleted:z.boolean()}).strict();
const attempt=z.object(storedAttempt.shape).strict().omit({prompt:true,owner:true,binding:true,marker:true,lease:true});
const appointment=storedAppointment.omit({creditId:true,accountBinding:true,consumeKey:true,owner:true});
const page=(item:z.ZodType)=>z.object({items:z.array(item).max(200),boundary:z.number().int().nonnegative(),nextCursor:z.string().nullable()}).strict();
const event=z.object({sequence:revision,resourceId:z.string(),at:z.string().datetime(),type:z.string(),reason:z.string(),revision:revision.nullable()}).strict();
const queue=z.object({revision,enabled:z.boolean(),limit:z.number().int().min(1).max(20)}).strict();
const scheduler=z.object({revision,enabled:z.boolean(),pollSeconds:z.number().int().min(10).max(300)}).strict();
const notification=notificationValues.extend({revision});
export const automationOutputs:Record<string,z.ZodType>={
 'templates.list':page(template),'templates.get':template,'templates.create':template,'templates.update':template,'templates.delete':template,'templates.setDefault':template,
 'tasks.list':page(task),'tasks.get':task,'tasks.create':task,'tasks.update':task,'tasks.enable':task,'tasks.pause':task,'tasks.remove':task,'archives.list':page(task),'archives.get':task,
 'tasks.revisions.list':page(z.object({revision,at:z.string().datetime()}).strict()),'timelines.get':page(event),
 'tasks.policy.get':z.object({id,revision,policy:taskConfigSchema.omit({prompt:true}),resumeCount:z.number().int().nonnegative(),authorization:task.shape.authorization}).strict(),
 'threads.send':attempt,'attempts.get':attempt,'attempts.list':page(attempt),'attempts.reconcile':attempt,'tasks.reconcile':z.object({items:z.array(attempt)}).strict(),
 'queue.get':queue.extend({held:z.number().int().nonnegative(),items:z.array(task)}),'queue.configure':queue,'tasks.reorder':z.object({id,order:z.number().int().nonnegative(),queueRevision:revision}).strict(),
 'scheduler.settings.get':scheduler.extend({running:z.boolean()}),'scheduler.settings.update':scheduler,'scheduler.runNow':z.object({id,accepted:z.literal(true),kind:z.literal('scheduler.runNow')}).strict(),
 'tasks.inspect':z.object({id,status:z.enum(['passed','blocked','unknown']),reasons:z.array(z.string()),providerChecked:z.boolean()}).strict(),
 'resetCards.list':z.object({source:z.enum(['unknown','fixture','live']),observedAt:z.string().datetime().nullable(),stale:z.boolean(),availability:z.enum(['unknown','known']),error:z.string().nullable(),items:z.array(z.object({cardKey:z.string(),title:z.string(),status:z.enum(['available','redeemed','redeeming','unknown']),expiresAt:z.string().datetime().nullable(),idSuffix:z.string()}).strict()).nullable()}).strict(),
 'resetAppointments.create':appointment,'resetAppointments.cancel':appointment,'resetAppointments.reconcile':appointment,'resetAppointments.list':page(appointment),
 'notifications.settings.get':notification,'notifications.settings.update':notification,
};
automationOutputs['resetCards.refresh']=automationOutputs['resetCards.list']!;
