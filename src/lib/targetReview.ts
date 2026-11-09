import { z } from 'zod';
import { executionPolicySchema, structuredExclusionSchema } from './programExecutionPolicy';
import { ASSET_TYPES, ASSET_VALUES, assetInputSchema, assetAllowsUrl, detectScopeAsset } from './scopeAssets';
import { matchesHost, normalizeFqdn } from './bountyProgram';

import { campaignSourceSchema, campaignIntervalSchema } from './campaignSource';
import { reviewRule, documentedAsset, programSectionsSchema } from './targetReviewData';
import { nonQualifyingTextSchema } from './programIntake';
export { RULE_DECISIONS } from './targetReviewData';

const scopeEntry = assetInputSchema.pick({ value: true }).extend({ type: z.enum(ASSET_TYPES), assetValue: z.enum(ASSET_VALUES).optional() });
const testAccount = z.strictObject({
  asset: z.string().min(1).max(2048),
  loginUrl: z.url().max(2048),
  username: z.string().min(1).max(512),
  password: z.string().min(1).max(512),
  purpose: z.enum(['ACCOUNT_A', 'ACCOUNT_B']),
});
export type ReviewRule = z.infer<typeof reviewRule>;
export type DocumentedAsset = z.infer<typeof documentedAsset>;
export type ScopeEntry = z.infer<typeof scopeEntry>;

export function scopeReviewChecks(scopeIn: ScopeEntry[], exclusions: string[]) {
  const seen = new Set<string>();
  let scopeError = '', conflict = '';
  const denied = new Set(exclusions.flatMap(value => structuredExclusionSchema.safeParse(value).success
    ? [detectScopeAsset(value).normalizedValue] : []));
  for (const row of scopeIn) {
    try {
      const asset = detectScopeAsset(row.value);
      if (!asset.executable) throw new Error('Use the non-automatable inventory for unsupported assets.');
      if (seen.has(asset.normalizedValue)) throw new Error('Remove the duplicate in-scope asset.');
      if (denied.has(asset.normalizedValue) && !conflict) conflict = 'Remove ' + asset.normalizedValue + ' from one side of scope.';
      seen.add(asset.normalizedValue);
    } catch (error) {
      if (!scopeError) scopeError = (row.value ? row.value + ' — ' : '') + (error as Error).message;
    }
  }
  if (!scopeError && exclusions.some(value => !structuredExclusionSchema.safeParse(value).success)) {
    scopeError = 'Use one valid URL, domain, wildcard, IP or CIDR per exclusion.';
  }
  return { scopeError, conflict };
}

/** Suggest a host only when it is already covered by an explicit wildcard.
 * The user still adds the exact identity before a credential can be stored. */
export function suggestTestAccountHost(scopeIn: ScopeEntry[], exclusions: string[], loginUrl: string) {
  const url = URL.parse(loginUrl.trim());
  if (url?.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
  let host: string;
  try { host = normalizeFqdn(url.hostname); } catch { return null; }
  const scope = scopeIn.flatMap(asset => {
    try { return [detectScopeAsset(asset.value)]; } catch { return []; }
  });
  if (!scope.some(asset => asset.format === 'WILDCARD_DOMAIN' && assetAllowsUrl(asset, loginUrl.trim())) ||
      scope.some(asset => asset.format !== 'WILDCARD_DOMAIN' && asset.executable && assetAllowsUrl(asset, url.href))) return null;

  for (const value of exclusions) {
    if (!structuredExclusionSchema.safeParse(value).success) continue;
    const asset = detectScopeAsset(value);
    if (asset.format === 'CIDR' || asset.format === 'IP') return null;
    if (asset.format === 'URL') {
      const exclusion = new URL(asset.normalizedValue);
      const prefix = exclusion.pathname.toLowerCase().replace(/\/\*$/, '/').replace(/\/$/, '');
      if (exclusion.origin === url.origin && (!prefix || url.pathname.toLowerCase() === prefix ||
          url.pathname.toLowerCase().startsWith(prefix + '/'))) return null;
    } else if (matchesHost(host, asset.normalizedValue)) return null;
  }
  return host;
}

export const targetReviewSchema = z.strictObject({
  scopeIn: z.array(scopeEntry).max(1000),
  documentedAssets: z.array(documentedAsset).max(3000),
  rules: z.array(reviewRule).max(5000),
  sourceDocument: z.string().max(2 * 1024 * 1024).optional(),
  programSections: programSectionsSchema.optional(),
  intakeVersion: z.literal(1).optional(),
  nonQualifyingText: nonQualifyingTextSchema.optional(),
  policy: executionPolicySchema.omit({ sourceSnapshot: true }),
  testAccounts: z.array(testAccount).max(2).default([]),
  expectedAssets: z.string().max(64).optional(),
  campaignInterval: campaignIntervalSchema.optional(),
  importSource: campaignSourceSchema.optional(),
}).superRefine((review, ctx) => {
  const { scopeError, conflict } = scopeReviewChecks(review.scopeIn, review.policy.exclusions);
  for (const message of [scopeError, conflict]) if (message) ctx.addIssue({ code: 'custom', path: ['scopeIn'], message });
  for (const [index, account] of review.testAccounts.entries()) {
    const url = URL.parse(account.loginUrl);
    const asset = review.scopeIn.find(row => row.value === account.asset);
    let valid = false;
    if (asset && url?.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash) {
      try {
        const boundary = detectScopeAsset(asset.value);
        valid = boundary.format !== 'WILDCARD_DOMAIN' && assetAllowsUrl(boundary, account.loginUrl);
      } catch { /* Scope validation already identifies the invalid entry. */ }
    }
    if (!valid) ctx.addIssue({ code: 'custom', path: ['testAccounts', index], message: 'Choose an exact in-scope asset and an HTTPS login URL within its boundary.' });
  }
});
export type TargetReview = z.infer<typeof targetReviewSchema>;
