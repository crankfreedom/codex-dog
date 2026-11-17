import type {AutomationStorePort,AutomationPorts} from './ports.ts';
import {AutomationError} from './ports.ts';
export function page<T>(store:AutomationStorePort,ports:AutomationPorts,namespace:string,filter:unknown,items:Array<{sequence:number;value:T}>,params:Record<string,unknown>){
 const fingerprint=ports.digest(JSON.stringify([namespace,filter])),secret=store.cursorKey();let boundary=items.at(-1)?.sequence??0,after=0;
 if(params.cursor){try{const raw=String(params.cursor);const split=raw.lastIndexOf('.'),payload=raw.slice(0,split);if(split<1||ports.digest(secret+payload)!==raw.slice(split+1))throw new Error();const value=JSON.parse(decodeURIComponent(payload));if(value.fingerprint!==fingerprint||!Number.isSafeInteger(value.boundary)||!Number.isSafeInteger(value.after)||value.after<0||value.after>value.boundary)throw new Error();boundary=value.boundary;after=value.after;}catch{throw new AutomationError('INVALID_ARGUMENT','游标损坏或不属于本次查询');}}
 const limit=Number(params.limit??50),eligible=items.filter(x=>x.sequence>after&&x.sequence<=boundary),selected=eligible.slice(0,limit);
 const token=selected.length&&eligible.length>limit?encodeURIComponent(JSON.stringify({fingerprint,boundary,after:selected.at(-1)!.sequence})):null;
 return {items:selected.map(x=>x.value),boundary,nextCursor:token?token+'.'+ports.digest(secret+token):null};
}
