import type { Monitoring } from '../../contracts/stage3.ts';
export class QuotaMonitor {
  private refresh:()=>Promise<unknown>;private now:()=>number;private schedule:(delay:number,run:()=>void)=>()=>void;
  private cancel?:()=>void;private closed=true;private policy:Monitoring={autoRefresh:false,quotaIntervalSeconds:600};private generation=0;
  private next:number|null=null;private lastAttempt:number|null=null;private result:string|null=null;
  constructor(options:{refresh:()=>Promise<unknown>;now:()=>number;schedule:(delay:number,run:()=>void)=>()=>void}){this.refresh=options.refresh;this.now=options.now;this.schedule=options.schedule;}
  start(policy:Monitoring){this.closed=false;this.configure(policy,true);}
  configure(policy:Monitoring,force=false){if(!force&&policy.autoRefresh===this.policy.autoRefresh&&policy.quotaIntervalSeconds===this.policy.quotaIntervalSeconds)return;this.cancel?.();this.generation++;this.policy={...policy};this.next=null;if(!this.closed&&policy.autoRefresh)this.arm(this.generation);}
  private arm(generation:number){this.next=this.now()+this.policy.quotaIntervalSeconds*1000;this.cancel=this.schedule(this.policy.quotaIntervalSeconds*1000,()=>{void this.tick(generation);});}
  private async tick(generation:number){if(this.closed||generation!==this.generation)return;this.next=null;this.lastAttempt=this.now();try{await this.refresh();this.result='succeeded';}catch{this.result='read_failed';}if(!this.closed&&generation===this.generation&&this.policy.autoRefresh)this.arm(generation);}
  status(){return {enabled:this.policy.autoRefresh,intervalSeconds:this.policy.quotaIntervalSeconds,nextCheckAt:this.next===null?null:new Date(this.next).toISOString(),lastAttemptAt:this.lastAttempt===null?null:new Date(this.lastAttempt).toISOString(),lastResult:this.result};}
  close(){this.closed=true;this.generation++;this.cancel?.();this.next=null;}
}
