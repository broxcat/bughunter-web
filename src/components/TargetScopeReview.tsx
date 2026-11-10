'use client';

import { Button } from '@/components/ui/Button';
import { ASSET_TYPES, ASSET_VALUES, assetTypeLabel, assetValueLabel, detectScopeAsset, type AssetType, type AssetValue } from '@/lib/scopeAssets';
import { LEGACY_LIMITS, structuredExclusionSchema } from '@/lib/programExecutionPolicy';
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
  const documentedExclusions = policy?.sourceSnapshot.programSections?.outOfScope ?? [];
  const documentedValues = new Set(documentedExclusions.filter(isStructuredExclusion).map(value => detectScopeAsset(value).normalizedValue));
  const exclusions = [...documentedExclusions, ...(policy?.exclusions ?? []).filter(value => !documentedValues.has(detectScopeAsset(value).normalizedValue)),
    ...(program?.legacyExclusions ?? [])];
  return {
    scopeIn: program?.scopeIn ?? [],
    exclusions: [...new Set(exclusions)].join('\n'),
    documentedAssets: policy?.sourceSnapshot.documentedAssets ?? [],
    rules: [],
    userAgent: (policy ? policy.requiredUserAgent : program?.requiredUserAgent) ?? '',
    policy: {
      automationAllowed: policy?.automationAllowed ?? true,
      ...(policy?.automationProhibition ? { automationProhibition: policy.automationProhibition } : {}),
      requiredHeaders: policy?.requiredHeaders ?? [],
      ...(policy?.userAgentMode ? { userAgentMode: policy.userAgentMode } : {}),
      requestsPerSecond: policy?.requestsPerSecond ?? LEGACY_LIMITS.requestsPerSecond,
      maxConcurrency: policy?.maxConcurrency ?? LEGACY_LIMITS.maxConcurrency,
      forbiddenCategories: policy?.forbiddenCategories ?? [],
    },
  };
}

export const isStructuredExclusion = (value: string) => structuredExclusionSchema.safeParse(value).success && detectScopeAsset(value).format !== 'HOSTNAME';

export function policyFields(value: ReviewFields, allowProse = false): TargetReview['policy'] {
  const exclusions = lines(value.exclusions);
  return { ...value.policy, exclusions: allowProse ? exclusions.filter(isStructuredExclusion) : exclusions, requiredUserAgent: value.userAgent.trim() || null };
}

export function TargetScopeReview({ value, onChange, allowProse }: { value: ReviewFields; onChange: (value: ReviewFields) => void; allowProse: boolean }) {
  const update = <K extends keyof ReviewFields>(key: K, next: ReviewFields[K]) => onChange({ ...value, [key]: next });
  const { scopeError, conflict } = scopeReviewChecks(value.scopeIn, policyFields(value, allowProse).exclusions);
  const policy = value.policy;
  const summary = [
    policy.requestsPerSecond + ' req/s', policy.maxConcurrency + ' concurrent',
    ...policy.requiredHeaders.map(({ name }) => 'header ' + name),
    ...policy.forbiddenCategories.map(category => readable(category) + ' forbidden'),
    ...(!policy.automationAllowed ? ['automation prohibited'] : []),
  ];
  return <section className="space-y-5 rounded border border-border p-4 sm:p-5">
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
        <label className="text-sm">Asset value<select className={fieldClass} aria-label={'Asset ' + (index + 1) + ' value'}
          value={asset.assetValue ?? 'MEDIUM'} onChange={event => update('scopeIn',
            value.scopeIn.map((row, i) => i === index ? { ...row, assetValue: event.target.value as AssetValue } : row))}>
          {ASSET_VALUES.map(level => <option key={level} value={level}>{assetValueLabel[level]}</option>)}
        </select></label>
        <Button variant="ghost" aria-label={'Remove asset ' + (index + 1)} onClick={() => update('scopeIn', value.scopeIn.filter((_, i) => i !== index))}>Remove</Button>
      </div>)}
      <Button variant="secondary" onClick={() => update('scopeIn', [...value.scopeIn, { value: '', type: 'WEB_APPLICATION' }])}>Add asset</Button>
      {scopeError && <p className="text-sm text-danger">{scopeError}</p>}
      {allowProse && value.documentedAssets.length > 0 && <details open={value.scopeIn.length === 0} className="text-sm">
        <summary>{value.documentedAssets.length} scope {value.documentedAssets.length === 1 ? 'entry' : 'entries'} kept for reference</summary>
        <ul className="mt-2 space-y-1 text-muted">
          {value.documentedAssets.map((asset, index) => <li key={asset.ref + index} className="break-words">
            {asset.originalValue ?? asset.sourceType} · {asset.sourceType}
          </li>)}
        </ul>
      </details>}
    </fieldset>
    <label id="out-of-scope" className="block font-semibold">Out of scope
      <textarea className={fieldClass + ' font-normal'} rows={3} placeholder="https://example.com/admin/*" value={value.exclusions}
        onChange={event => update('exclusions', event.target.value)} />
      <span className="text-sm font-normal text-muted">{allowProse ? 'Exact assets are enforced automatically. Other exclusions stay in the program record.' : 'One URL, domain, wildcard, IP or CIDR per line. Exclusions take precedence.'}</span>
    </label>
    {conflict && <p className="text-sm text-danger">{conflict}</p>}
    <p className="text-sm text-muted" aria-label="Execution policy summary">{summary.join(' · ')}</p>
  </section>;
}
