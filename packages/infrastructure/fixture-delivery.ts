import type {Attempt,DeliveryPorts} from '../modules/automation/ports.ts';
import {fixtureThreadIds} from './fixture-threads.ts';
import {assessUniqueReceipt} from '../modules/delivery/receipt-evidence.ts';
export interface FixtureReceiptStore {saveFixtureReceipt(marker:string,turnId:string):void;readFixtureReceipt(marker:string):string|null}
export class FixtureDelivery {
 private store:FixtureReceiptStore;private loseResponse:boolean;
 constructor(store:FixtureReceiptStore,loseResponse=false){this.store=store;this.loseResponse=loseResponse;}
 async dispatch(attempt:Attempt,finalGuard:()=>Promise<void>):ReturnType<DeliveryPorts['dispatch']>{
  try{await finalGuard();}catch{return {outcome:'not_written',turnId:null};}
  const turnId='fixture-delivery-'+attempt.id;this.store.saveFixtureReceipt(attempt.marker,turnId);return this.loseResponse?{outcome:'uncertain',turnId:null}:{outcome:'submitted',turnId};
 }
 async receipt(attempt:Attempt):ReturnType<DeliveryPorts['receipt']>{
  if(attempt.source!=='fixture')return {matched:false,turnId:null,turnFinished:false,goalComplete:false};
  const turnId=this.store.readFixtureReceipt(attempt.marker),expected={intentId:attempt.id,marker:attempt.marker,source:'fixture',providerInstance:'fixture-receipt-store-v1',accountBinding:attempt.binding.accountBinding,threadId:attempt.threadRef.threadId,turnId:attempt.turnId};
  const assessment=assessUniqueReceipt(expected,{kind:'durable-server-receipt',source:'fixture',providerInstance:'fixture-receipt-store-v1',evidenceId:'fixture-'+attempt.id,projection:'source-metadata-only',query:{intentId:attempt.id,marker:attempt.marker,accountBinding:attempt.binding.accountBinding,threadId:attempt.threadRef.threadId,scope:'exact-intent',complete:true,durable:true},records:turnId?[{receiptId:'fixture-'+attempt.id,intentId:attempt.id,marker:attempt.marker,accountBinding:attempt.binding.accountBinding,threadId:attempt.threadRef.threadId,turnId,turnStatus:'completed'}]:[]});
  return {matched:assessment.status==='matched',turnId:assessment.turnId,turnFinished:assessment.turnFinished,goalComplete:assessment.status==='matched'&&attempt.threadRef.threadId===fixtureThreadIds[3]};
 }
}
