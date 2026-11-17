import type {Appointment,CardProviderPort,CardObservation} from '../modules/cards/ports.ts';
interface FixtureCardsStore {fixtureCardConsumed(creditId:string):boolean;consumeFixtureCard(key:string,creditId:string):string}
export class FixtureCards implements CardProviderPort {
 private store:FixtureCardsStore;private now:()=>number;private loseResponse:boolean;
 constructor(store:FixtureCardsStore,now:()=>number,loseResponse=false){this.store=store;this.now=now;this.loseResponse=loseResponse;}
 async read():Promise<CardObservation>{return {source:'fixture',accountBinding:'fixture-card-account',observedAt:new Date(this.now()).toISOString(),verified:true,cards:['fixture-card-one','fixture-card-two'].map((id,index)=>({id,title:'模拟重置卡 '+(index+1),status:this.store.fixtureCardConsumed(id)?'redeemed':'available',expiresAt:null}))};}
 async consume(appointment:Appointment,guard:()=>Promise<void>):ReturnType<CardProviderPort['consume']>{try{await guard();}catch{return {outcome:'not_written' as const};}const outcome=this.store.consumeFixtureCard(appointment.consumeKey,appointment.creditId) as 'reset'|'alreadyRedeemed';return {outcome:this.loseResponse?'uncertain':outcome};}
 reconcile(appointment:Appointment,guard:()=>Promise<void>){return this.consume(appointment,guard);}
 async close(){}
}
