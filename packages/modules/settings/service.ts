import { appearanceSchema, monitoringSchema, defaultAppearance, defaultMonitoring, settingsUpdate,themeIds } from '../../contracts/stage3.ts';
import type { Stage3StorePort, SettingView } from '../persistence/stage3-ports.ts';
import { Stage3Error } from '../persistence/stage3-ports.ts';

export class SettingsService {
  private store:Pick<Stage3StorePort,'readSetting'|'commitSetting'>;
  private now:()=>number;
  private digest:(value:string)=>string;
  constructor(store:SettingsService['store'],now:()=>number,digest:(value:string)=>string){this.store=store;this.now=now;this.digest=digest;}
  start(){ this.get('appearance');this.get('monitoring'); }
  get(section:SettingView['section']):SettingView {
    const value=this.store.readSetting(section);
    const schema=section==='appearance'?appearanceSchema:monitoringSchema;
    const parsed=schema.safeParse(value.values);
    if(!parsed.success)throw new Stage3Error('STORAGE_FAILURE','设置分区数据无效，拒绝使用默认值覆盖');
    return {...value,values:parsed.data};
  }
  update(raw:unknown,owner:string,key:string|undefined,guard:()=>void):SettingView {
    const parsed=settingsUpdate.safeParse(raw);if(!parsed.success)throw new Stage3Error('INVALID_ARGUMENT','设置参数不符合分区契约');
    if(!key)throw new Stage3Error('INVALID_ARGUMENT','设置保存必须携带幂等键');
    guard();const input=parsed.data;const before=this.get(input.section);
    const schema=input.section==='appearance'?appearanceSchema:monitoringSchema;
    const values=schema.parse({...before.values,...input.patch});
    const digest=this.digest(JSON.stringify({section:input.section,expectedRevision:input.expectedRevision,patch:input.patch}));
    guard();return this.store.commitSetting({section:input.section,expectedRevision:input.expectedRevision,values,owner,key,digest,at:new Date(this.now()).toISOString()});
  }
  presets(){return structuredClone({defaults:defaultAppearance,monitoringDefaults:defaultMonitoring,themes:themeIds.map((id,index)=>({id,label:(index<10?'纯色 ':'渐变 ')+(index%10+1)})),presets:[{id:'default',label:'默认',values:defaultAppearance},{id:'reading',label:'舒适阅读',values:{...defaultAppearance,titleSize:32,sectionSize:22,bodySize:18,captionSize:14,navSize:16,lineHeight:1.9,contrast:'high'}},{id:'compact',label:'紧凑',values:{...defaultAppearance,titleSize:24,bodySize:13,lineHeight:1.5,density:'compact'}}]});}
}
