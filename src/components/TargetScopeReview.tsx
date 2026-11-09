'use client';

import { Button } from '@/components/ui/Button';
import { ASSET_TYPES, assetTypeLabel, detectScopeAsset, type AssetType } from '@/lib/scopeAssets';
import { headersFromLines, LEGACY_LIMITS, POLICY_REVIEW_ANCHOR, TEST_CATEGORIES } from '@/lib/programExecutionPolicy';
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
  pendingRule: string;
  pendingDocument: string;
  userAgent: string;
  headers: string;
  requests: string;
  concurrency: string;
  automation: boolean;
  forbidden: TargetReview['policy']['forbiddenCategories'];
};
export function initialReview(program?: ProgramData): ReviewFields {
  const policy = program?.executionPolicies?.[0]?.policy;
  const legacy = program?.legacyPolicyReview;
  const existing = policy?.sourceSnapshot.ruleDecisions ?? (policy?.sourceSnapshot.unrepresentedRules ?? []).map(text => ({ text, decision: null }));
  const added = (!policy || legacy?.scopeChanged ? legacy?.unrepresentedRules ?? [] : [])
    .filter(text => !existing.some(rule => rule.text === text)).map(text => ({ text, decision: null }));
  return {
    scopeIn: program?.scopeIn ?? [],
    exclusions: [...new Set([...(policy?.exclusions ?? []), ...(legacy?.exclusions ?? [])])].join('\n'),
    documentedAssets: policy?.sourceSnapshot.documentedAssets ?? [],
    rules: [...existing, ...added],
    pendingRule: '',
    pendingDocument: '',
    userAgent: (policy ? policy.requiredUserAgent : program?.requiredUserAgent) ?? '',
    headers: policy?.requiredHeaders.map(({ name, value }) => name + ': ' + value).join('\n') ?? '',
    requests: String(policy?.requestsPerSecond ?? (policy && policy.requestsPerSecond === null ? '' : LEGACY_LIMITS.requestsPerSecond)),
    concurrency: String(policy?.maxConcurrency ?? (policy && policy.maxConcurrency === null ? '' : LEGACY_LIMITS.maxConcurrency)),
    automation: Boolean(policy?.automationAllowed && !legacy?.scopeChanged),
    forbidden: policy?.forbiddenCategories ?? [],
  };
}

export function policyFields(value: ReviewFields): TargetReview['policy'] {
  return {
    automationAllowed: value.automation,
    exclusions: lines(value.exclusions),
    requiredUserAgent: value.userAgent.trim() || null,
    requiredHeaders: headersFromLines(value.headers),
    requestsPerSecond: Number(value.requests),
    maxConcurrency: Number(value.concurrency),
    forbiddenCategories: value.forbidden,
  };
}

export function TargetScopeReview({ value, onChange, historical = [], candidates = [] }: {
  value: ReviewFields;
  onChange: (value: ReviewFields) => void;
  historical?: DocumentedAsset[];
  candidates?: DocumentedAsset[];
}) {
  const update = <K extends keyof ReviewFields>(key: K, next: ReviewFields[K]) => onChange({ ...value, [key]: next });
  const pending = value.rules.filter(rule => !rule.decision).length + Number(Boolean(value.pendingRule.trim()));
  const { scopeError, conflict } = scopeReviewChecks(value.scopeIn, lines(value.exclusions));
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
    <details className="ui-disclosure" open={Boolean(value.documentedAssets.length || historical.length || candidates.length)}>
      <summary>Non-automatable and unrepresented assets</summary>
      <ul className="mt-3 space-y-2 text-sm">{[...value.documentedAssets, ...historical, ...candidates].map((asset, index) =>
        <li key={asset.ref + index} className="break-all"><strong>{asset.originalValue ?? asset.sourceType}</strong> · {asset.sourceType}
          {asset.reason && <span className="text-muted"> · {asset.reason}</span>}
          {candidates.includes(asset) && asset.originalValue && canAdd(asset.originalValue) && <Button size="sm" variant="ghost" onClick={() => {
            const detected = detectScopeAsset(asset.originalValue!);
            update('scopeIn', [...value.scopeIn, { value: detected.normalizedValue, type: detected.inferredType }]);
          }}>Add to scope</Button>}
        </li>)}</ul>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1 text-sm">Document an asset<input className={fieldClass} value={value.pendingDocument} onChange={event => update('pendingDocument', event.target.value)} /></label>
        <Button variant="secondary" disabled={!value.pendingDocument.trim()} onClick={() => {
          const text = value.pendingDocument.trim();
          onChange({ ...value, pendingDocument: '', documentedAssets: [...value.documentedAssets, { ref: 'manual:' + text, originalValue: text, sourceType: 'Manual' }] });
        }}>Keep for reference</Button>
      </div>
    </details>
    <div className="grid gap-3 sm:grid-cols-2">
      <label>Requests per second<input className={fieldClass} type="number" min="0.01" max="100" step="0.01" value={value.requests} onChange={event => update('requests', event.target.value)} /></label>
      <label>Maximum concurrent requests<input className={fieldClass} type="number" min="1" max="32" value={value.concurrency} onChange={event => update('concurrency', event.target.value)} /></label>
    </div>
    <label className="block">Required User-Agent<input className={fieldClass} value={value.userAgent} maxLength={512} onChange={event => update('userAgent', event.target.value)} />
      <span className="text-sm text-muted">Leave blank to use your hunter identity from Settings.</span>
    </label>
    <label className="block">Required headers<textarea className={fieldClass} rows={2} placeholder="X-Bug-Bounty: your-username" value={value.headers} onChange={event => update('headers', event.target.value)} /></label>
    <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-3"><legend className="mb-2 font-medium">Forbidden test categories</legend>
      {TEST_CATEGORIES.map(category => <label key={category} className="text-sm"><input type="checkbox" checked={value.forbidden.includes(category)}
        onChange={event => update('forbidden', event.target.checked ? [...value.forbidden, category] : value.forbidden.filter(item => item !== category))} /> {readable(category)}</label>)}
    </fieldset>
    <fieldset className="space-y-3"><legend className="font-semibold">Unrepresented rules</legend>
      {pending > 0 && <p className="text-sm text-danger">{pending} {pending === 1 ? 'rule needs' : 'rules need'} a decision. You can save now. Automation will stay blocked.</p>}
      {value.rules.map((rule, index) => <div key={index} id={'policy-rule-' + (index + 1)} className="scroll-mt-24 space-y-2 rounded border border-border p-3">
        {rule.assetRef && <p className="break-all text-xs text-muted">Asset · {rule.assetLabel ?? rule.assetRef}</p>}
        <p className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-sm">{rule.text}</p>
        <fieldset className="flex flex-wrap gap-3 text-sm"><legend className="sr-only">Decision for rule {index + 1}</legend>
          {([['CONVERTED', 'Converted above'], ['NOT_RELEVANT', 'Not relevant to automation']] as const).map(([decision, label]) => <label key={decision}>
            <input type="radio" name={'rule-' + index} checked={rule.decision === decision} onChange={() =>
              update('rules', value.rules.map((row, i) => i === index ? { ...row, decision } : row))} /> {label}
          </label>)}
          {rule.decision && <Button variant="ghost" size="sm" onClick={() => update('rules', value.rules.map((row, i) => i === index ? { ...row, decision: null } : row))}>Clear decision</Button>}
        </fieldset>
      </div>)}
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1 text-sm">Add a rule<textarea className={fieldClass} rows={2} value={value.pendingRule} onChange={event => update('pendingRule', event.target.value)} /></label>
        <Button variant="secondary" disabled={!value.pendingRule.trim()} onClick={() => {
          onChange({ ...value, pendingRule: '', rules: [...value.rules, { text: value.pendingRule.trim(), decision: null }] });
        }}>Add rule</Button>
      </div>
    </fieldset>
    <label className="block"><input type="checkbox" checked={value.automation} onChange={event => update('automation', event.target.checked)} /> Allow automation after review</label>
  </section>;
}

function canAdd(value: string) {
  try { return detectScopeAsset(value).executable; } catch { return false; }
}
