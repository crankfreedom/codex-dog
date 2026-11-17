import type {Attempt,DeliveryPorts} from '../modules/automation/ports.ts';
import {fixtureThreadIds} from './fixture-threads.ts';
export interface FixtureReceiptStore {saveFixtureReceipt(marker:string,turnId:string):void;readFixtureReceipt(marker:string):string|null}
export class FixtureDelivery {
 private store:FixtureReceiptStore;private loseResponse:boolean;
 constructor(store:FixtureReceiptStore,loseResponse=false){this.store=store;this.loseResponse=loseResponse;}
 async dispatch(attempt:Attempt,finalGuard:()=>Promise<void>):ReturnType<DeliveryPorts['dispatch']>{
  try{await finalGuard();}catch{return {outcome:'not_written',turnId:null};}
  const turnId='fixture-delivery-'+attempt.id;this.store.saveFixtureReceipt(attempt.marker,turnId);return this.loseResponse?{outcome:'uncertain',turnId:null}:{outcome:'submitted',turnId};
 }
 async receipt(attempt:Attempt):ReturnType<DeliveryPorts['receipt']>{if(attempt.source!=='fixture')return {matched:false,turnId:null,turnFinished:false,goalComplete:false};const turnId=this.store.readFixtureReceipt(attempt.marker);return {matched:!!turnId,turnId,turnFinished:!!turnId,goalComplete:!!turnId&&attempt.threadRef.threadId===fixtureThreadIds[3]};}
}
