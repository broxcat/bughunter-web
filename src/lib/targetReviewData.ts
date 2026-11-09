import { z } from 'zod';

export const RULE_DECISIONS = ['CONVERTED', 'NOT_RELEVANT'] as const;
export const reviewRule = z.strictObject({
  text: z.string().min(1).max(1024 * 1024),
  assetRef: z.string().max(4096).optional(),
  assetLabel: z.string().max(1024 * 1024).optional(),
  decision: z.enum(RULE_DECISIONS).nullable().default(null),
  origin: z.enum(['AI_INTAKE', 'SOURCE_CHANGED', 'PLATFORM_RESYNC']).optional(),
});
export const documentedAsset = z.strictObject({
  ref: z.string().max(4096),
  originalValue: z.string().max(1024 * 1024).nullable(),
  sourceType: z.string().max(2048),
  reason: z.string().max(2048).optional(),
});
