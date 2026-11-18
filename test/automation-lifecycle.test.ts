import test from 'node:test';
import assert from 'node:assert/strict';
import {TemplateService} from '../packages/modules/templates/service.ts';
import {TaskService} from '../packages/modules/tasks/service.ts';
import {DeliveryService} from '../packages/modules/delivery/service.ts';
import {SchedulerService} from '../packages/modules/scheduler/service.ts';
import {CardService} from '../packages/modules/cards/service.ts';
import {NotificationService} from '../packages/modules/notifications/service.ts';
import {OperationService} from '../packages/modules/operations/service.ts';
import type {AutomationStorePort,DeliveryPorts} from '../packages/modules/automation/ports.ts';
import type {CardProviderPort} from '../packages/modules/cards/ports.ts';

test('新增业务模块构造不读取存储、调用端口或启动计时器，生命周期由宿主显式开始',()=>{
 const unexpected=()=>{assert.fail('构造阶段发生 IO 或调度');};
 const store=new Proxy({} as AutomationStorePort,{get:unexpected});
 const ports=new Proxy({} as DeliveryPorts,{get:unexpected});
 const provider=new Proxy({} as CardProviderPort,{get:unexpected});
 const delivery=new DeliveryService(store,ports);
 assert(new TemplateService(store,ports));assert(new TaskService(store,ports));assert(delivery);
 assert(new SchedulerService(store,ports,delivery,unexpected));assert(new CardService(store,ports,provider,unexpected,unexpected));
 assert(new NotificationService(store,ports,unexpected,unexpected));assert(new OperationService(store,ports));
});
