import test from 'node:test';
import assert from 'node:assert/strict';
import {readSubmissionObservation} from '../apps/desktop/renderer/submission-observation.ts';
import type {OperationName} from '../packages/contracts/protocol.ts';

const ref={connectionId:'fixture-connection',threadId:'fixture-target'};
const gate=(source:'fixture'|'live')=>({status:source==='fixture'?'not_checked':'blocked',checks:[],source,observedAt:new Date(0).toISOString(),readOnly:true,realSendingEnabled:false});
test('真实发送参数准备在门禁返回后停止，不调用会话接口或发送接口',async()=>{
 const calls:OperationName[]=[];await assert.rejects(readSubmissionObservation(async operation=>{calls.push(operation);assert.equal(operation,'diagnostics.run');return{deliveryGates:gate('live')};},ref),/^Error: TARGET_BINDING_UNVERIFIED/);assert.deepEqual(calls,['diagnostics.run']);
});
test('缺失/未知/自称允许真实发送的门禁均不回退到会话读取',async()=>{
 for(const report of [undefined,{...gate('fixture'),source:'unknown'},{...gate('live'),realSendingEnabled:true},{...gate('fixture'),extra:true}]){const calls:OperationName[]=[];await assert.rejects(readSubmissionObservation(async operation=>{calls.push(operation);return{deliveryGates:report};},ref),/^Error: PROTOCOL_INCOMPATIBLE/);assert.deepEqual(calls,['diagnostics.run']);}
});
test('明确模拟来源才读取指定模拟目标，业务观察结果不由页面重新计算',async()=>{
 const calls:Array<{operation:OperationName;params:Record<string,unknown>}>=[],observation={source:'fixture',connectionRevision:2,latestTurn:{id:'fixture-turn'},goal:{current:null}};
 const result=await readSubmissionObservation(async(operation,params)=>{calls.push({operation,params});return operation==='diagnostics.run'?{deliveryGates:gate('fixture')}:observation;},ref);
 assert.equal(result,observation);assert.deepEqual(calls,[{operation:'diagnostics.run',params:{threadRef:ref,includeDeliveryGates:true}},{operation:'threads.get',params:ref}]);
});
test('门禁与随后观察来源冲突时不返回可用于准备发送的结果',async()=>{
 await assert.rejects(readSubmissionObservation(async operation=>operation==='diagnostics.run'?{deliveryGates:gate('fixture')}:{source:'live',connectionRevision:1},ref),/^Error: TARGET_BINDING_UNVERIFIED/);
});
