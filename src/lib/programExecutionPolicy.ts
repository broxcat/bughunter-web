
import { z } from 'zod';
import { requiredUserAgentSchema } from './httpPolicy.mjs';
import { assetInputSchema, detectScopeAsset } from './scopeAssets';
import { documentedAsset, programSectionsSchema, reviewRule } from './targetReviewData';

export const TEST_CATEGORIES = [
  'PASSIVE_RECON', 'DNS_LOOKUP', 'PORT_SCAN', 'ACTIVE_SCANNING', 'CRAWLING',
  'FUZZING', 'BRUTE_FORCE', 'DENIAL_OF_SERVICE', 'AUTHENTICATED_TESTING', 'BROWSER',
] as const;
export type TestCategory = typeof TEST_CATEGORIES[number];

const forbiddenHeaders = new Set([
  'host', 'user-agent', 'content-length', 'transfer-encoding', 'connection', 'upgrade',
  'keep-alive', 'te', 'trailer', 'expect', 'cookie', 'authorization', 'forwarded',
  'x-bughunter-request-id', 'accept-encoding', 'via', 'content-encoding',
]);
const headerName = z.string().toLowerCase().regex(/^[!#$%&'*+.^_`|~0-9a-z-]{1,80}$/)
  .refine(name => !forbiddenHeaders.has(name) && !/^(proxy-|sec-|x-forwarded-|:)/.test(name), 'Header is reserved');
const headerValue = z.string().trim().regex(/^[\x20-\x7e]{1,1024}$/).refine(value => !/\\[rn]/.test(value), 'Literal HTTP line escapes are unsupported');
export const identificationHeadersSchema = z.array(z.strictObject({ name: headerName, value: headerValue }))
  .max(16).refine(headers => new Set(headers.map(header => header.name)).size === headers.length, 'Duplicate header');

export const hunterIdentitySchema = z.strictObject({
  userAgent: requiredUserAgentSchema.refine(value => !/\\[rn]/.test(value)).nullable(),
  headers: identificationHeadersSchema,
});
export type HunterIdentity = z.infer<typeof hunterIdentitySchema>;

export const structuredExclusionSchema = assetInputSchema.shape.value.refine(value => {
  try {
    const boundary = detectScopeAsset(value);
    if (boundary.format !== 'URL') return true;
    const path = new URL(boundary.normalizedValue).pathname;
    return !/[%;]/.test(path) && !path.replace(/\/\*$/, '').includes('*');
  } catch { return false; }
}, 'Use a URL path prefix or a trailing /* wildcard');

export const legacyScopeTextSchema = z.strictObject({
  id: z.string(), scopeDetails: z.string().nullable(), outOfScope: z.string().nullable(),
  rulesOfEngagement: z.string().nullable(),
});
export type LegacyScopeText = z.infer<typeof legacyScopeTextSchema>;
const sourceSnapshotSchema = z.strictObject({
  url: z.url().refine(value => /^https?:\/\//i.test(value)).nullable(),
  rules: z.string().max(20000),
  unrepresentedRules: z.array(z.string().trim().min(1).max(2000)).max(50),
});
export const executionPolicySchema = z.strictObject({
  automationAllowed: z.boolean(),
  requiredUserAgent: hunterIdentitySchema.shape.userAgent,
  userAgentMode: z.literal('APPEND').optional(),
  requiredHeaders: identificationHeadersSchema,
  exclusions: z.array(structuredExclusionSchema).max(1000),
  requestsPerSecond: z.number().min(0.01).max(100),
  maxConcurrency: z.number().int().min(1).max(32),
  forbiddenCategories: z.array(z.enum(TEST_CATEGORIES)).max(TEST_CATEGORIES.length),
  sourceSnapshot: sourceSnapshotSchema,
});
export type ExecutionPolicyInput = z.infer<typeof executionPolicySchema>;

// Only server writers can set review status and capture the legacy source.
export function policyDraftNeedsReview(state?: string) {
  return state === 'BACKFILL_DRAFT' || state === 'IMPORT_DRAFT';
}

export const storedExecutionPolicySchema = executionPolicySchema.extend({
  requestsPerSecond: executionPolicySchema.shape.requestsPerSecond.nullable(),
  maxConcurrency: executionPolicySchema.shape.maxConcurrency.nullable(),
  reviewState: z.enum(['BACKFILL_DRAFT', 'IMPORT_DRAFT', 'OWNER_REVIEWED']).optional(),
  sourceSnapshot: sourceSnapshotSchema.extend({
    // Historical data may predate input validation. Preserve it byte for byte.
    url: z.string().nullable(),
    rules: z.string(),
    unrepresentedRules: z.array(z.string()),
    documentedAssets: z.array(documentedAsset).optional(),
    sourceDocument: z.string().optional(),
    programSections: programSectionsSchema.optional(),
    intakeVersion: z.literal(1).optional(),
    nonQualifyingText: z.array(z.string()).optional(),
    ruleDecisions: z.array(reviewRule).optional(),
    legacy: z.strictObject({
      outOfScope: z.array(z.string()),
      scopes: z.array(legacyScopeTextSchema),
      programRules: z.string().nullable(),
    }).optional(),
  }),
}).refine(policy => policyDraftNeedsReview(policy.reviewState) || (policy.requestsPerSecond !== null && policy.maxConcurrency !== null), 'Reviewed policies require request limits');
export type StoredExecutionPolicy = z.infer<typeof storedExecutionPolicySchema>;
export const LEGACY_LIMITS = { requestsPerSecond: 5, maxConcurrency: 2 };
export const POLICY_REVIEW_ANCHOR = 'execution-policy';
export const MISSING_HUNTER_UA = 'Recon requires a User-Agent. Set the program User-Agent in Target settings or configure DEFAULT_USER_AGENT.';
export const MISSING_HUNTER_USERNAME = 'Program identification requires a hunter username. Configure HUNTER_USERNAME before automation can run.';

const usernameTemplate = /(?:\$?\{\{?\s*(?:your[\s_-]*)?(?:hackerone[\s_-]*|hunter[\s_-]*)?user[\s_-]*name\s*\}\}?|\[\s*(?:your[\s_-]*)?(?:hackerone[\s_-]*|hunter[\s_-]*)?user[\s_-]*name(?:\s+here)?\s*\]|<\s*(?:your[\s_-]*)?(?:hackerone[\s_-]*|hunter[\s_-]*)?user[\s_-]*name\s*>|%(?:HUNTER_)?USERNAME%|<\s*(?:your\s+)?yes\s*we\s*hack\s+(?:pseudo|username)\s*>|#\s*yes\s*we\s*hack\s*user\s*name\s*#)/i;
export const hasHunterTemplate = (value: string) => usernameTemplate.test(value);
export const hasHunterUsername = (value?: string) => Boolean(value && /^[!-~]{1,128}$/.test(value) && !hasHunterTemplate(value));
export const replaceHunterTemplate = (value: string, username: string) =>
  value.replace(new RegExp(usernameTemplate.source, 'gi'), () => username);

export function headersFromLines(text: string) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const colon = line.indexOf(':');
    return { name: colon > 0 ? line.slice(0, colon).trim() : '', value: line.slice(colon + 1).trim() };
  });
}
