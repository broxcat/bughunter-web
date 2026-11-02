import { z } from 'zod';
import { persistedCorpusSchema } from './corpus';
export const assetHttpSchema = z.object({ url: z.string().max(2048), method: z.literal('GET'), statusCode: z.number().int().min(100).max(599), contentType: z.string().max(100), observedAt: z.iso.datetime(), authenticationSchemes: z.array(z.enum(['basic', 'bearer', 'digest', 'negotiate'])).max(4), redirect: z.string().max(2048).optional() });
export const assetEvidenceSchema = z.object({ version: z.literal(1), scopeAssetId: z.string(), bounded: z.boolean(), historicalUrls: z.array(z.string().max(2048)).max(1000).default([]), hosts: z.array(z.object({
  hostname: z.string().max(253), capturedAt: z.iso.datetime(), corpus: persistedCorpusSchema,
  dns: z.array(z.string().max(100)).max(100), http: z.array(assetHttpSchema).max(25),
  ports: z.array(z.object({ port: z.number().int().min(1).max(65535), state: z.enum(['open', 'closed', 'filtered']), serviceLabel: z.string().max(40) })).max(20),
  tls: z.object({ validFrom: z.string().max(80), validTo: z.string().max(80), fingerprint256: z.string().max(100) }).optional(),
})).max(8) });
export type AssetEvidence = z.infer<typeof assetEvidenceSchema>;
