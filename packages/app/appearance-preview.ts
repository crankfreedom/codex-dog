import { appearanceSchema,previewInput } from '../contracts/stage3.ts';
import type { Appearance } from '../contracts/stage3.ts';
import type { SettingView,ActorRef } from '../modules/persistence/stage3-ports.ts';
import { Stage3Error } from '../modules/persistence/stage3-ports.ts';
export class AppearancePreview {
  private ports:{read:()=>Promise<SettingView>;apply:(value:Appearance,previewId:string|null)=>void;visible:()=>boolean;newId:()=>string};
  private saved?:SettingView;private active?:{id:string;owner:string;values:Appearance};
  private requests=new Map<string,{body:string;result:{previewId:string;values:Appearance;savedRevision:number;active:boolean}}>();
  constructor(ports:AppearancePreview['ports']){this.ports=ports;}
  async get(guard:()=>void){const value=await this.ports.read();guard();if(this.saved&&value.revision!==this.saved.revision)this.clear();this.saved=value;if(!this.active)this.ports.apply(appearanceSchema.parse(value.values),null);return {...value,preview:this.active?{id:this.active.id,values:structuredClone(this.active.values)}:null};}
  async preview(raw:unknown,actor:ActorRef,key:string|undefined,guard:()=>void){
    const parsed=previewInput.safeParse(raw);if(!parsed.success)throw new Stage3Error('INVALID_ARGUMENT','外观预览参数无效');
    if(!key)throw new Stage3Error('INVALID_ARGUMENT','预览必须携带幂等键');
    await this.get(guard);guard();if(!this.ports.visible())throw new Stage3Error('WINDOW_UNAVAILABLE','没有可见的主窗口，不能预览');
    const scoped=actor.clientId+':'+key,body=JSON.stringify(parsed.data),existing=this.requests.get(scoped);
    if(existing){if(existing.body!==body)throw new Stage3Error('IDEMPOTENCY_CONFLICT','同键预览参数不同');return structuredClone(existing.result);}
    if(this.requests.size>=2048)throw new Stage3Error('CLIENT_LIMIT','当前窗口预览记录达到上限');
    if(parsed.data.expectedRevision!==this.saved!.revision)throw new Stage3Error('REVISION_CONFLICT','已保存外观发生变化');
    if(this.active&&this.active.owner!==actor.clientId&&actor.kind!=='desktop')throw new Stage3Error('REVISION_CONFLICT','另一个客户端正在预览');
    if(parsed.data.previewId&&parsed.data.previewId!==this.active?.id)throw new Stage3Error('REVISION_CONFLICT','预览已失效');
    const values=appearanceSchema.parse({...this.saved!.values,...parsed.data.patch});this.clear();guard();const id=this.ports.newId();this.active={id,owner:actor.clientId,values};
    const result={previewId:id,values,savedRevision:this.saved!.revision,active:true};this.requests.set(scoped,{body,result});this.ports.apply(values,id);return structuredClone(result);
  }
  cancel(id:string,actor:ActorRef,guard:()=>void){guard();if(this.active?.id===id){if(this.active.owner!==actor.clientId&&actor.kind!=='desktop')throw new Stage3Error('PERMISSION_DENIED','不能撤销其他客户端预览');this.clear();return {cancelled:true,previewId:id};}const previous=[...this.requests.entries()].find(([,value])=>value.result.previewId===id);if(!previous)throw new Stage3Error('REVISION_CONFLICT','预览不存在或属于旧实例');if(!previous[0].startsWith(actor.clientId+':')&&actor.kind!=='desktop')throw new Stage3Error('PERMISSION_DENIED','不能撤销其他客户端预览');return {cancelled:true,previewId:id};}
  clear(){if(!this.active)return;const id=this.active.id;this.active=undefined;for(const request of this.requests.values())if(request.result.previewId===id)request.result.active=false;if(this.saved)this.ports.apply(appearanceSchema.parse(this.saved.values),null);}
  revoke(clientId:string){if(this.active?.owner===clientId)this.clear();}
  async savedChanged(){this.clear();await this.get(()=>{});}
}
