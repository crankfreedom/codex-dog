import test from 'node:test';
import assert from 'node:assert/strict';
import {assessUniqueReceipt} from '../packages/modules/delivery/receipt-evidence.ts';
import type {ExpectedReceipt,ReceiptEvidence} from '../packages/modules/delivery/receipt-evidence.ts';

const expected:ExpectedReceipt={intentId:'intent-one',marker:'original-marker',source:'live',providerInstance:'desktop-pid-endpoint-session-one',accountBinding:'account-fingerprint-one',threadId:'thread-one',turnId:null};
function proof():ReceiptEvidence {return {
 kind:'durable-server-receipt',source:'live',providerInstance:expected.providerInstance,evidenceId:'controlled-fixture-observation',projection:'source-metadata-only',
 query:{intentId:expected.intentId,marker:expected.marker,accountBinding:expected.accountBinding,threadId:expected.threadId,scope:'exact-intent',complete:true,durable:true},
 records:[{receiptId:'provider-receipt-one',intentId:expected.intentId,marker:expected.marker,accountBinding:expected.accountBinding,threadId:expected.threadId,turnId:'destination-turn-one',turnStatus:'inProgress'}],
};}

test('隔离证据只在原意图、原marker、同源会话、账号/线程和持久完整查询都匹配时返回唯一轮次',()=>{
 const input=proof(),snapshot=structuredClone(input);assert.deepEqual(assessUniqueReceipt(expected,input),{status:'matched',code:'RECEIPT_MATCHED',turnId:'destination-turn-one',turnFinished:false});assert.deepEqual(input,snapshot);
 input.records[0]!.turnStatus='completed';assert.equal(assessUniqueReceipt(expected,input).turnFinished,true);
 // This is a fixture of a future provider shape, not evidence that any installed live provider supports it.
 assert.equal(assessUniqueReceipt({...expected,source:'fixture'},{...input,source:'fixture'}).status,'matched');
});

test('只回threadId、调用方callId/turnId和瞬时通知均不升级为回执',()=>{
 assert.equal(assessUniqueReceipt(expected,{threadId:expected.threadId}).code,'RECEIPT_INVALID_METADATA');
 for(const kind of ['submission-ack','caller-context','live-notification'] as const){const input=proof();input.kind=kind;assert.equal(assessUniqueReceipt(expected,input).code,'RECEIPT_NOT_DURABLE');}
 const forged=proof();Object.assign(forged,{callId:expected.intentId,turnId:'dog-send-'+expected.intentId});assert.equal(assessUniqueReceipt(expected,forged).code,'RECEIPT_INVALID_METADATA');
});

test('未命中、部分分页、不持久和不可用证据保持未知，不能作为未发送或释放槽位的证明',()=>{
 const input=proof();input.records=[];assert.deepEqual(assessUniqueReceipt(expected,input),{status:'unknown',code:'RECEIPT_NO_MATCH',turnId:null,turnFinished:false});
 input.query.complete=false;assert.equal(assessUniqueReceipt(expected,input).code,'RECEIPT_INCOMPLETE');input.query.complete=true;input.query.durable=false;assert.equal(assessUniqueReceipt(expected,input).code,'RECEIPT_NOT_DURABLE');input.kind='unavailable';assert.equal(assessUniqueReceipt(expected,input).code,'RECEIPT_UNAVAILABLE');
});

test('查询过滤或返回记录身份变化、跨源或端点会话变化均拒绝，不把当前账号等同于目标归属',()=>{
 for(const key of ['intentId','marker','accountBinding','threadId'] as const){const input=proof();input.query[key]='different';assert.equal(assessUniqueReceipt(expected,input).code,'RECEIPT_QUERY_MISMATCH');
  const record=proof();record.records[0]![key]='different';assert.equal(assessUniqueReceipt(expected,record).code,'RECEIPT_BINDING_CONFLICT');}
 const wrongSource=proof();wrongSource.source='fixture';assert.equal(assessUniqueReceipt(expected,wrongSource).code,'RECEIPT_SOURCE_MISMATCH');
 const changed=proof();changed.providerInstance='another-session';assert.equal(assessUniqueReceipt(expected,changed).code,'RECEIPT_PROVIDER_CHANGED');
 const broad=proof();broad.query.scope='thread-history';assert.equal(assessUniqueReceipt(expected,broad).code,'RECEIPT_QUERY_MISMATCH');
});

test('重复回执即使指向同一turn也不猜去重，既有turn冲突不得覆盖',()=>{
 const duplicate=proof();duplicate.records.push({...duplicate.records[0]!});assert.equal(assessUniqueReceipt(expected,duplicate).code,'RECEIPT_AMBIGUOUS');
 assert.equal(assessUniqueReceipt({...expected,turnId:'already-bound-turn'},proof()).code,'RECEIPT_TURN_CONFLICT');
 assert.equal(assessUniqueReceipt({...expected,turnId:'destination-turn-one'},proof()).status,'matched');
});

test('客户端脱敏和聊天正文扫描不能冒充源端无正文投影，额外敏感字段拒绝且输出不回显',()=>{
 for(const projection of ['client-redacted','content-scan','unknown'] as const){const input=proof();input.projection=projection;assert.equal(assessUniqueReceipt(expected,input).code,'RECEIPT_PRIVACY_UNVERIFIED');}
 const sensitive=proof();Object.assign(sensitive.records[0]!,{body:'禁止回显的内容',objective:'禁止回显的目标'});const result=assessUniqueReceipt(expected,sensitive);assert.equal(result.code,'RECEIPT_INVALID_METADATA');
 const output=JSON.stringify(result);for(const secret of [expected.marker,expected.accountBinding,'禁止回显的内容','禁止回显的目标'])assert(!output.includes(secret));
 const tooMany=proof();tooMany.records=Array.from({length:201},()=>({...tooMany.records[0]!}));assert.equal(assessUniqueReceipt(expected,tooMany).code,'RECEIPT_INVALID_METADATA');
});
