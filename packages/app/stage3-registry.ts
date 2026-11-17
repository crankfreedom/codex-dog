import { definitions,apiVersion,failure } from '../contracts/protocol.ts';
import type { Request,Response } from '../contracts/protocol.ts';
import type { ActorRef } from '../modules/persistence/stage3-ports.ts';
import { Stage3Error } from '../modules/persistence/stage3-ports.ts';
import { SettingsService } from '../modules/settings/service.ts';
import { HistoryService } from '../modules/history/service.ts';
import { DiagnosticsService } from '../modules/diagnostics/service.ts';
import { QuotaMonitor } from '../modules/quota/monitor.ts';
import type { Monitoring } from '../contracts/stage3.ts';
import { stage3Outputs } from '../contracts/stage3.ts';
import type { RuntimeIdentity } from './registry.ts';
export class Stage3Registry {
  private settings:SettingsService;private history:HistoryService;private diagnostics:DiagnosticsService;private monitor:QuotaMonitor;private identity:RuntimeIdentity;private authorize:(actor:ActorRef,scope:'read'|'settings.manage')=>Promise<void>;
  constructor(options:{settings:SettingsService;history:HistoryService;diagnostics:DiagnosticsService;monitor:QuotaMonitor;identity:RuntimeIdentity;authorize:(actor:ActorRef,scope:'read'|'settings.manage')=>Promise<void>}){this.settings=options.settings;this.history=options.history;this.diagnostics=options.diagnostics;this.monitor=options.monitor;this.identity=options.identity;this.authorize=options.authorize;}
  async start(){this.settings.start();await this.history.start();this.monitor.start(this.settings.get('monitoring').values as unknown as Monitoring);}
  async invoke(request:Request,actor?:ActorRef):Promise<Response>{
    const definition=definitions.find(x=>x.operation===request.operation),parsed=definition?.input.safeParse(request.params);
    if(!parsed?.success)return failure('INVALID_ARGUMENT','阶段 3 参数无效',request.requestId);
    if(!actor)return failure('AUTH_REQUIRED','缺少可信调用身份',request.requestId);
    const params=parsed.data as Record<string,unknown>;let data:Record<string,unknown>;
    try{
      switch(request.operation){
        case 'settings.get':data={...this.settings.get(params.section as 'appearance'|'monitoring')};break;
        case 'appearance.get':data={...this.settings.get('appearance')};break;
        case 'quota.policy.get':data={...this.settings.get('monitoring'),runtime:this.monitor.status()};break;
        case 'appearance.presets':data=this.settings.presets();break;
        case 'settings.update':case 'appearance.update':case 'quota.policy.update':{
          await this.authorize(actor,'settings.manage');const input=request.operation==='settings.update'?params:{...params,section:request.operation==='appearance.update'?'appearance':'monitoring'};
          const saved=this.settings.update(input,actor.clientId,request.idempotencyKey,()=>{});data={...saved};if(saved.section==='monitoring')this.monitor.configure(this.settings.get('monitoring').values as unknown as Monitoring);break;
        }
        case 'diagnostics.run':data=await this.diagnostics.run(params.threadRef as Record<string,unknown>|undefined);break;
        case 'events.query':data=this.history.query(params);break;
        case 'events.subscribe':data=await this.history.subscribe(params,actor);break;
        case 'events.export':data=await this.history.export(params,actor,request.idempotencyKey);break;
        case 'operations.get':data=this.history.get(String(params.id),actor.clientId,actor.kind==='desktop'||actor.canManageOperations===true);break;
        case 'operations.list':data=this.history.list(actor.clientId,Number(params.limit),actor.kind==='desktop'||actor.canManageOperations===true);break;
        case 'operations.cancel':data=await this.history.cancel(String(params.id),actor,request.idempotencyKey);break;
        default:return failure('CAPABILITY_UNSUPPORTED','该阶段能力未注册',request.requestId);
      }
      const output=stage3Outputs[request.operation]?.safeParse(data);if(!output?.success)return failure('PROTOCOL_INCOMPATIBLE','阶段 3 输出不符合契约',request.requestId);
      return {ok:true,data:output.data as Record<string,unknown>,meta:{apiVersion,requestId:request.requestId,source:'local',...this.identity}};
    }catch(error){return failure(error instanceof Stage3Error?error.code:'STORAGE_FAILURE',error instanceof Stage3Error?error.message:'本应用设置或历史服务失败',request.requestId);}
  }
  async close(){this.monitor.close();await this.history.close();}
}
