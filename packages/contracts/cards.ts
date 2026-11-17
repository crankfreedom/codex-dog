import {z} from 'zod';
const empty=z.object({}).strict(),id=z.object({id:z.string().uuid()}).strict();
export const cardDefinitions=[
 {operation:'resetCards.list',command:['reset-cards','list'],tool:'reset_cards_list',description:'读取当前卡片观察，未知/过期不伪装为空卡或正常。',input:empty,scope:'read',readOnly:true},
 {operation:'resetCards.refresh',command:['reset-cards','refresh'],tool:'reset_cards_refresh',description:'显式读取卡片明细，不推进预约或消费。',input:empty,scope:'read',readOnly:true},
 {operation:'resetAppointments.list',command:['reset-appointments','list'],tool:'reset_appointments_list',description:'读取脱敏预约和持久结果。',input:z.object({limit:z.number().int().min(1).max(200).default(50),cursor:z.string().max(2000).optional()}).strict(),scope:'read',readOnly:true},
 {operation:'resetAppointments.create',command:['reset-appointments','create'],tool:'reset_appointments_create',description:'明确指定卡片预约，绑定账号、卡片及唯一消费键。',input:z.object({cardKey:z.string().regex(/^[a-f0-9]{64}$/),scheduledAt:z.string().datetime({offset:true}),timeZone:z.string().min(1).max(100).refine(x=>{try{new Intl.DateTimeFormat('en',{timeZone:x});return true;}catch{return false;}}),confirm:z.literal(true)}).strict(),scope:'cards.manage',readOnly:false},
 {operation:'resetAppointments.cancel',command:['reset-appointments','cancel'],tool:'reset_appointments_cancel',description:'仅取消尚未领取的预约，不能撤回消费。',input:id.extend({expectedRevision:z.number().int().positive()}),scope:'cards.manage',readOnly:false},
 {operation:'resetAppointments.reconcile',command:['reset-appointments','reconcile'],tool:'reset_appointments_reconcile',description:'以原卡原键核对；明确确认可能完成原消费，不创建新意图。',input:id.extend({confirmMayComplete:z.literal(true)}),scope:'cards.manage',readOnly:false},
] as const;
export const cardOperations=new Set<string>(cardDefinitions.map(x=>x.operation));
