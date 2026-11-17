import { z } from 'zod';

const repository = z.literal('crankfreedom/codex-dog');
const legacy = z.object({ kind: z.literal('g05-test'), repository, profile: z.string().regex(/^g05-install-[a-z0-9-]+$/) }).strict();
const preview = z.object({ kind: z.literal('release-preview'), repository, channel: z.literal('beta'), profile: z.string().regex(/^g06-preview-[a-z0-9-]{1,40}$/), signatureRequired: z.literal(false) }).strict();
const release = z.object({ kind: z.literal('release'), repository, channel: z.enum(['stable', 'beta']), profile: z.enum(['default', 'beta']), signatureRequired: z.literal(true), publisherName: z.string().trim().min(1).max(200) }).strict().refine(value => value.profile === (value.channel === 'stable' ? 'default' : 'beta'), '发行通道与数据目录不匹配');
export const distributionSchema = z.union([legacy, preview, release]);
export type Distribution = z.infer<typeof distributionSchema>;
export function parseDistribution(value: unknown): Distribution {
  return distributionSchema.parse(value);
}
