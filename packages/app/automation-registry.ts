import {stage3Outputs} from '../contracts/stage3.ts';
import { definitions,apiVersion,failure } from '../contracts/protocol.ts';
import type { Request,Response } from '../contracts/protocol.ts';
import type { ActorRef } from '../modules/persistence/stage3-ports.ts';
import { AutomationError } from '../modules/automation/ports.ts';
import { TemplateService } from '../modules/templates/service.ts';
import { TaskService } from '../modules/tasks/service.ts';
import type { RuntimeIdentity } from './registry.ts';
import {DeliveryService} from '../modules/delivery/service.ts';
import {SchedulerService} from '../modules/scheduler/service.ts';
import {CardService} from '../modules/cards/service.ts';
import {NotificationService} from '../modules/notifications/service.ts';
import {automationOutputs} from '../contracts/automation-outputs.ts';
import {OperationService} from '../modules/operations/service.ts';
export class AutomationRegistry {
  private templates:TemplateService;private tasks:TaskService;private identity:RuntimeIdentity;private delivery:DeliveryService;private scheduler:SchedulerService;private cards:CardService;private notifications:NotificationService;private operations:OperationService;
  constructor(templates:TemplateService,tasks:TaskService,identity:RuntimeIdentity,delivery:DeliveryService,scheduler:SchedulerService,cards:CardService,notifications:NotificationService,operations:OperationService){this.templates=templates;this.tasks=tasks;this.identity=identity;this.delivery=delivery;this.scheduler=scheduler;this.cards=cards;this.notifications=notifications;this.operations=operations;}
  hasOperation(id:string,actor:ActorRef){return this.operations.owns(id,actor);}
  listOperations(actor:ActorRef,limit:number){return this.operations.list(actor,limit);}
  start(){this.delivery.start();this.scheduler.start();this.cards.start();this.notifications.start();}
  async close(){this.delivery.stopNew();this.notifications.close();await this.scheduler.close();await this.cards.close();await this.delivery.close();}
  async prepareUpdate(){this.suspend();await Promise.all([this.delivery.drain(),this.cards.drain()]);}
  suspend(){this.delivery.stopNew();this.scheduler.suspend();this.cards.suspend();}
  resume(){this.cards.resume();this.delivery.resume();this.scheduler.resume();}
  async invoke(request:Request,actor?:ActorRef):Promise<Response>{
    const definition=definitions.find(x=>x.operation===request.operation),parsed=definition?.input.safeParse(request.params);
    if(!parsed?.success)return failure('INVALID_ARGUMENT','自动化参数无效',request.requestId);
    if(!actor)return failure('AUTH_REQUIRED','缺少可信调用身份',request.requestId);
    try{const service=request.operation.startsWith('operations.')?this.operations:request.operation.startsWith('notifications.')?this.notifications:request.operation.startsWith('reset')?this.cards:request.operation.startsWith('templates.')?this.templates:request.operation.startsWith('queue.')||request.operation.startsWith('scheduler.')||['tasks.reorder','tasks.inspect'].includes(request.operation)?this.scheduler:request.operation.startsWith('attempts.')||['threads.send','tasks.reconcile'].includes(request.operation)?this.delivery:this.tasks;
      const data=await service.invoke(request.operation,parsed.data as Record<string,unknown>,actor,request.idempotencyKey);
      const output=(automationOutputs[request.operation]??stage3Outputs[request.operation])?.safeParse(data);if(!output?.success)return failure('PROTOCOL_INCOMPATIBLE','自动化输出不符合契约',request.requestId);
      return {ok:true,data:output.data as Record<string,unknown>,meta:{apiVersion,requestId:request.requestId,source:'local',...this.identity}};
    }catch(error){const known=error&&typeof error==='object'&&'code'in error&&typeof error.code==='string';return failure(known?String(error.code):'STORAGE_FAILURE',error instanceof AutomationError?error.message:'自动化操作失败，状态保持保守',request.requestId);}
  }
}
