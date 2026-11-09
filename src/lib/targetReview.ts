import { z } from 'zod';
import { executionPolicySchema, structuredExclusionSchema } from './programExecutionPolicy';
import { ASSET_TYPES, assetInputSchema, assetAllowsUrl, detectScopeAsset } from './scopeAssets';

import { reviewRule, documentedAsset } from './targetReviewData';
export { RULE_DECISIONS } from './targetReviewData';

const scopeEntry = assetInputSchema.pick({ value: true }).extend({ type: z.enum(ASSET_TYPES) });
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

export const targetReviewSchema = z.strictObject({
  scopeIn: z.array(scopeEntry).max(1000),
  documentedAssets: z.array(documentedAsset).max(3000),
  rules: z.array(reviewRule).max(5000),
  sourceDocument: z.string().max(2 * 1024 * 1024).optional(),
  policy: executionPolicySchema.omit({ sourceSnapshot: true }),
  testAccounts: z.array(testAccount).max(2).default([]),
  expectedAssets: z.string().max(64).optional(),
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
