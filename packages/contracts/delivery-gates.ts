import {z} from 'zod';
export const deliveryGateCheck=z.object({id:z.string().max(80),status:z.enum(['passed','blocked','unknown','not_checked']),reason:z.string().max(100),source:z.enum(['local','fixture','live'])}).strict();
export const deliveryGateReport=z.object({status:z.enum(['blocked','unknown','not_checked']),checks:z.array(deliveryGateCheck).max(20),source:z.enum(['fixture','live']),observedAt:z.string().datetime(),readOnly:z.literal(true),realSendingEnabled:z.literal(false)}).strict();
export type DeliveryGateReport=z.infer<typeof deliveryGateReport>;
export type DeliveryGateCheck=z.infer<typeof deliveryGateCheck>;
// These are wire diagnostics, never an uploadable authority, business grant or permission to dispatch.
// Passed rows describe only the scope named by that row; the full live gate stays closed.
// Account fingerprints, original markers, lock tokens and source records are not public report fields.
// Local persisted metadata does not establish the desktop's current idle or approval state.
// Old-lock absence is an instant observation, not atomic ownership or crash-recovery compatibility.
