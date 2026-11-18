import {z} from 'zod';

const opaque=z.string().min(1).max(512).refine(value=>value===value.trim()&&!/[\x00-\x1f\x7f]/.test(value));
const source=z.enum(['live','fixture']);
const expectedSchema=z.object({
 intentId:opaque,marker:opaque,source,providerInstance:opaque,accountBinding:opaque,threadId:opaque,turnId:opaque.nullable().optional(),
}).strict();
const querySchema=z.object({
 intentId:opaque,marker:opaque,accountBinding:opaque,threadId:opaque,
 scope:z.enum(['exact-intent','thread-history','unknown']),complete:z.boolean(),durable:z.boolean(),
}).strict();
const recordSchema=z.object({
 receiptId:opaque,intentId:opaque,marker:opaque,accountBinding:opaque,threadId:opaque,turnId:opaque,
 turnStatus:z.enum(['inProgress','completed','failed','interrupted','unknown']),
}).strict();
const evidenceSchema=z.object({
 kind:z.enum(['durable-server-receipt','submission-ack','live-notification','caller-context','unavailable']),
 source,providerInstance:opaque,evidenceId:opaque,
 projection:z.enum(['source-metadata-only','client-redacted','content-scan','unknown']),
 query:querySchema,records:z.array(recordSchema).max(200),
}).strict();

export type ExpectedReceipt=z.infer<typeof expectedSchema>;
export type ReceiptEvidence=z.infer<typeof evidenceSchema>;
export type ReceiptEvidenceCode='RECEIPT_MATCHED'|'RECEIPT_INVALID_METADATA'|'RECEIPT_UNAVAILABLE'|'RECEIPT_SOURCE_MISMATCH'|'RECEIPT_PROVIDER_CHANGED'|'RECEIPT_PRIVACY_UNVERIFIED'|'RECEIPT_QUERY_MISMATCH'|'RECEIPT_INCOMPLETE'|'RECEIPT_NOT_DURABLE'|'RECEIPT_NO_MATCH'|'RECEIPT_AMBIGUOUS'|'RECEIPT_BINDING_CONFLICT'|'RECEIPT_TURN_CONFLICT';
export interface ReceiptAssessment {
 status:'matched'|'unknown'|'conflict';code:ReceiptEvidenceCode;turnId:string|null;turnFinished:boolean;
}
const blocked=(code:ReceiptEvidenceCode,status:'unknown'|'conflict'='unknown'):ReceiptAssessment=>({status,code,turnId:null,turnFinished:false});

/** Only trusted internal ports may supply this envelope; its provenance strings do not authenticate themselves.
 * The live port must remain unavailable until a real source supplies the required metadata and query guarantees.
 * A zero match is never evidence of non-delivery, and this assessor cannot cancel, replay or release an intent.
 */
export function assessUniqueReceipt(expectedInput:unknown,evidenceInput:unknown):ReceiptAssessment {
 const expectation=expectedSchema.safeParse(expectedInput),observation=evidenceSchema.safeParse(evidenceInput);
 if(!expectation.success||!observation.success)return blocked('RECEIPT_INVALID_METADATA');
 const expected=expectation.data,evidence=observation.data,query=evidence.query;
 if(evidence.kind==='unavailable')return blocked('RECEIPT_UNAVAILABLE');
 if(evidence.source!==expected.source)return blocked('RECEIPT_SOURCE_MISMATCH','conflict');
 if(evidence.providerInstance!==expected.providerInstance)return blocked('RECEIPT_PROVIDER_CHANGED','conflict');
 if(evidence.projection!=='source-metadata-only')return blocked('RECEIPT_PRIVACY_UNVERIFIED');
 if(evidence.kind!=='durable-server-receipt'||!query.durable)return blocked('RECEIPT_NOT_DURABLE');
 if(query.scope!=='exact-intent'||query.intentId!==expected.intentId||query.marker!==expected.marker||query.accountBinding!==expected.accountBinding||query.threadId!==expected.threadId)return blocked('RECEIPT_QUERY_MISMATCH','conflict');
 if(!query.complete)return blocked('RECEIPT_INCOMPLETE');
 if(!evidence.records.length)return blocked('RECEIPT_NO_MATCH');
 if(evidence.records.length!==1)return blocked('RECEIPT_AMBIGUOUS','conflict');
 const record=evidence.records[0]!;
 if(record.intentId!==expected.intentId||record.marker!==expected.marker||record.accountBinding!==expected.accountBinding||record.threadId!==expected.threadId)return blocked('RECEIPT_BINDING_CONFLICT','conflict');
 if(expected.turnId&&record.turnId!==expected.turnId)return blocked('RECEIPT_TURN_CONFLICT','conflict');
 return {status:'matched',code:'RECEIPT_MATCHED',turnId:record.turnId,turnFinished:['completed','failed','interrupted'].includes(record.turnStatus)};
}
