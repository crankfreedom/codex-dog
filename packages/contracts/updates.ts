import {z} from 'zod';
export const updateConfiguration=z.object({revision:z.number().int().positive(),automaticCheck:z.boolean(),intervalSeconds:z.number().int().min(300).max(86400),automaticDownload:z.literal(false)}).strict();
export const updateConfigureParams=updateConfiguration.omit({revision:true}).extend({expectedRevision:z.number().int().positive(),channel:z.enum(['stable','beta'])});
