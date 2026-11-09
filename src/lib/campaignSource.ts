import { z } from 'zod';
import { IMPORT_PLATFORMS } from './platformConnections';
import { VULNERABILITY_FAMILIES } from './bountyProgram';
import { TEST_CATEGORIES, structuredExclusionSchema } from './programExecutionPolicy';
import type { ProgramPreview } from '@/server/programImport/normalize';

export const campaignIntervalSchema = z.number().int().min(60).max(43200).nullable();
export const pendingScopeAssetSchema = z.object({
  value: z.string().min(1).max(2048),
  type: z.enum(['API', 'WEB_APPLICATION', 'WILDCARD']),
});
export const pendingScopeSchema = z.array(pendingScopeAssetSchema).max(1000);
export const campaignSourceSchema = z.strictObject({
  url: z.url().max(2048),
  platform: z.enum(IMPORT_PLATFORMS),
  grants: z.array(z.string().max(2048)).max(2000),
  sourceDocument: z.string().max(64_000).optional(),
  assets: pendingScopeSchema,
  exclusions: z.array(structuredExclusionSchema).max(1000),
  forbiddenCategories: z.array(z.enum(TEST_CATEGORIES)).max(TEST_CATEGORIES.length),
  nonQualifying: z.array(z.enum(VULNERABILITY_FAMILIES)).max(VULNERABILITY_FAMILIES.length),
  rules: z.array(z.object({ text: z.string().max(1024 * 1024), assetRef: z.string().max(4096).optional() })).max(5000),
});
export type CampaignSource = z.infer<typeof campaignSourceSchema>;

export function captureCampaignSource(preview: ProgramPreview): CampaignSource {
  const assets = new Map(preview.scopeIn.flatMap(asset => asset.normalizedValue ? [[asset.normalizedValue, {
    value: asset.normalizedValue, type: asset.format === 'WILDCARD_DOMAIN' ? 'WILDCARD'
      : asset.sourceType.toLowerCase() === 'api' ? 'API' : 'WEB_APPLICATION',
  }]] as const : []));
  return campaignSourceSchema.parse({
    url: preview.url, platform: preview.platform, grants: preview.sourceGrants,
    assets: [...assets.values()],
    exclusions: preview.policy.exclusions,
    forbiddenCategories: preview.policy.forbiddenCategories,
    rules: preview.sourceRules, nonQualifying: preview.nonQualifying,
  });
}
