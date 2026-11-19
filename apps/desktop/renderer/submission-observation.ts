import {deliveryGateReport} from '../../../packages/contracts/delivery-gates.ts';
import type {OperationName} from '../../../packages/contracts/protocol.ts';

type Request=(operation:OperationName,params:Record<string,unknown>)=>Promise<Record<string,unknown>>;
/** Presentation preparation only; business authorization remains in the application handler. */
export async function readSubmissionObservation(request:Request,threadRef:{connectionId:string;threadId:string}){
 const diagnostic=await request('diagnostics.run',{threadRef,includeDeliveryGates:true});
 const gate=deliveryGateReport.safeParse(diagnostic.deliveryGates);
 if(!gate.success)throw new Error('PROTOCOL_INCOMPATIBLE：缺少可核对的发送来源门禁，未读取会话');
 if(gate.data.source!=='fixture')throw new Error('TARGET_BINDING_UNVERIFIED：真实执行绑定和无正文唯一回执未证实，未读取会话或发送');
 const observation=await request('threads.get',threadRef);
 if(observation.source!=='fixture')throw new Error('TARGET_BINDING_UNVERIFIED：观察来源与模拟门禁不一致，停止准备发送');
 return observation;
}
