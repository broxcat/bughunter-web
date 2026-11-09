'use client';

import { Button } from '@/components/ui/Button';
import { ASSET_TYPES, assetTypeLabel, type AssetType } from '@/lib/scopeAssets';
import { LEGACY_LIMITS, POLICY_REVIEW_ANCHOR } from '@/lib/programExecutionPolicy';
import { scopeReviewChecks, type DocumentedAsset, type ReviewRule, type ScopeEntry, type TargetReview } from '@/lib/targetReview';
import type { ProgramData } from '@/lib/targetFormData';

export const fieldClass = 'mt-1 block w-full rounded border border-border bg-surface p-2';
export const lines = (value: string) => value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
export const readable = (value: string) => value.toLowerCase().replaceAll('_', ' ');

export type ReviewFields = {
  scopeIn: ScopeEntry[];
  exclusions: string;
  documentedAssets: DocumentedAsset[];
  rules: ReviewRule[];
  policy: Omit<TargetReview['policy'], 'exclusions' | 'requiredUserAgent'>;
  userAgent: string;
};

export function initialReview(program?: ProgramData): ReviewFields {
  const policy = program?.executionPolicies?.[0]?.policy;
  const legacy = program?.legacyPolicyReview;
  const existing: ReviewRule[] = policy?.sourceSnapshot.ruleDecisions ??
    (policy?.sourceSnapshot.unrepresentedRules ?? []).map(text => ({ text, decision: null }));
  const added = (!policy || legacy?.scopeChanged ? legacy?.unrepresentedRules ?? [] : [])
    .filter(text => !existing.some(rule => rule.text === text)).map(text => ({ text, decision: null }));
  return {
    scopeIn: program?.scopeIn ?? [],
    exclusions: [...new Set([...(policy?.exclusions ?? []), ...(legacy?.exclusions ?? [])])].join('\n'),
    documentedAssets: policy?.sourceSnapshot.documentedAssets ?? [],
    rules: [...existing, ...added],
    userAgent: (policy ? policy.requiredUserAgent : program?.requiredUserAgent) ?? '',
    policy: {
      automationAllowed: policy?.automationAllowed ?? true,
      requiredHeaders: policy?.requiredHeaders ?? [],
      requestsPerSecond: policy?.requestsPerSecond ?? LEGACY_LIMITS.requestsPerSecond,
      maxConcurrency: policy?.maxConcurrency ?? LEGACY_LIMITS.maxConcurrency,
      forbiddenCategories: policy?.forbiddenCategories ?? [],
    },
  };
}

export function policyFields(value: ReviewFields): TargetReview['policy'] {
  return { ...value.policy, exclusions: lines(value.exclusions), requiredUserAgent: value.userAgent.trim() || null };
}

export function TargetScopeReview({ value, onChange }: { value: ReviewFields; onChange: (value: ReviewFields) => void }) {
  const update = <K extends keyof ReviewFields>(key: K, next: ReviewFields[K]) => onChange({ ...value, [key]: next });
  const { scopeError, conflict } = scopeReviewChecks(value.scopeIn, lines(value.exclusions));
  const policy = value.policy;
  const summary = [
    policy.requestsPerSecond + ' req/s', policy.maxConcurrency + ' concurrent',
    ...policy.requiredHeaders.map(({ name }) => 'header ' + name),
    ...policy.forbiddenCategories.map(category => readable(category) + ' forbidden'),
    ...(!policy.automationAllowed ? ['automation prohibited'] : []),
  ];
  return <section id={POLICY_REVIEW_ANCHOR} className="space-y-5 rounded border border-border p-4 sm:p-5">
    <h2 className="text-lg font-semibold">Scope and execution policy</h2>
    <fieldset className="space-y-2"><legend className="font-semibold">In scope</legend>
      {!value.scopeIn.length && <p className="text-sm text-muted">Add the domains, wildcards or URLs you are authorized to test.</p>}
      {value.scopeIn.map((asset, index) => <div key={index} className="flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1 text-sm">Asset {index + 1}<input className={fieldClass} value={asset.value}
          placeholder="https://app.example.com" onChange={event => update('scopeIn', value.scopeIn.map((row, i) => i === index ? { ...row, value: event.target.value } : row))} /></label>
        <label className="text-sm">Type<select className={fieldClass} aria-label={'Asset ' + (index + 1) + ' type'} value={asset.type}
          onChange={event => update('scopeIn', value.scopeIn.map((row, i) => i === index ? { ...row, type: event.target.value as AssetType } : row))}>
          {ASSET_TYPES.filter(type => type !== 'OTHER' || asset.type === 'OTHER').map(type => <option key={type} value={type}>{assetTypeLabel[type]}</option>)}
        </select></label>
        <Button variant="ghost" aria-label={'Remove asset ' + (index + 1)} onClick={() => update('scopeIn', value.scopeIn.filter((_, i) => i !== index))}>Remove</Button>
      </div>)}
      <Button variant="secondary" onClick={() => update('scopeIn', [...value.scopeIn, { value: '', type: 'WEB_APPLICATION' }])}>Add asset</Button>
      {scopeError && <p className="text-sm text-danger">{scopeError}</p>}
    </fieldset>
    <label id="out-of-scope" className="block font-semibold">Out of scope
      <textarea className={fieldClass + ' font-normal'} rows={3} placeholder="https://example.com/admin/*" value={value.exclusions}
        onChange={event => update('exclusions', event.target.value)} />
      <span className="text-sm font-normal text-muted">One URL, domain, wildcard, IP or CIDR per line. Exclusions take precedence.</span>
    </label>
    {conflict && <p className="text-sm text-danger">{conflict}</p>}
    <label className="block">Required User-Agent<input className={fieldClass} value={value.userAgent} maxLength={512}
      onChange={event => update('userAgent', event.target.value)} />
      <span className="text-sm text-muted">Leave blank to use DEFAULT_USER_AGENT.</span>
    </label>
    <p className="text-sm text-muted" aria-label="Execution policy summary">{summary.join(' · ')}</p>
    {value.rules.map((rule, index) => !rule.decision && <span key={index} id={'policy-rule-' + (index + 1)} className="scroll-mt-24" />)}
  </section>;
}
