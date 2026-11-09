import { z } from 'zod';
import { BOUNTY_PLATFORMS, VULNERABILITY_FAMILIES } from './bountyProgram';
import { executionPolicySchema } from './programExecutionPolicy';
import { ASSET_TYPES, ASSET_VALUES } from './scopeAssets';
import { documentedAsset, programSectionsSchema, rewardFieldsSchema } from './targetReviewData';

export const MAX_PROGRAM_SOURCE = 64_000;
export const intakeInput = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('url'), url: z.string().trim().min(1).max(2048) }),
  z.strictObject({ mode: z.literal('markdown'), markdown: z.string().max(MAX_PROGRAM_SOURCE).refine(value => Boolean(value.trim())), platform: z.enum(BOUNTY_PLATFORMS).optional() }),
]);
export type IntakeInput = z.infer<typeof intakeInput>;
const vulnerabilityLine = z.string().trim().min(1).max(500).regex(/^[^\r\n]+$/);
export const nonQualifyingTextSchema = z.array(vulnerabilityLine).max(100);
const aliases: Record<string, (typeof VULNERABILITY_FAMILIES)[number]> = {
  'cross site scripting': 'XSS', 'insecure direct object reference': 'IDOR',
  'broken access control': 'ACCESS_CONTROL', 'authentication bypass': 'AUTHENTICATION',
  'server side request forgery': 'SSRF', 'xml external entity': 'XXE', 'local file inclusion': 'LFI',
  'remote file inclusion': 'RFI', 'cross origin resource sharing': 'CORS',
  'cross site request forgery': 'CSRF', 'remote code execution': 'RCE',
  'server side template injection': 'SSTI', 'insecure deserialization': 'DESERIALIZATION',
};
const familyNames = new Map<string, (typeof VULNERABILITY_FAMILIES)[number]>(
  VULNERABILITY_FAMILIES.map(value => [value.toLowerCase().replaceAll('_', ' '), value]),
);

export function splitNonQualifying(lines: string[]) {
  const families = new Set<(typeof VULNERABILITY_FAMILIES)[number]>();
  const text = new Set<string>();
  for (const line of lines) {
    const key = line.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
    const family = familyNames.get(key) ?? (Object.hasOwn(aliases, key) ? aliases[key] : undefined);
    if (family) families.add(family);
    else if (key) text.add(line.trim());
  }
  return { families: [...families], text: [...text] };
}

export const intakePreviewSchema = z.strictObject({
  url: z.string().max(2048).nullable(), name: z.string().trim().max(200),
  platform: z.enum(BOUNTY_PLATFORMS).nullable(),
  scopeIn: z.array(z.strictObject({ value: z.string().min(1).max(2048), type: z.enum(ASSET_TYPES), assetValue: z.enum(ASSET_VALUES).optional() })).max(1000),
  policy: executionPolicySchema.omit({ sourceSnapshot: true }),
  nonQualifying: nonQualifyingTextSchema,
  sourceDocument: z.string().max(MAX_PROGRAM_SOURCE),
  programSections: programSectionsSchema.optional(),
  rewards: rewardFieldsSchema.optional(),
  documentedAssets: z.array(documentedAsset).max(1000),
  unresolved: z.array(z.string().min(1).max(MAX_PROGRAM_SOURCE)).max(100),
  omitted: z.array(z.string().min(1).max(2048)).max(1000),
});
export type IntakePreview = z.infer<typeof intakePreviewSchema>;
