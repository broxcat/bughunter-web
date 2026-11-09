'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { BOUNTY_PLATFORMS, VULNERABILITY_FAMILIES } from '@/lib/bountyProgram';
import { platformLabel } from '@/lib/platformPresentation';
import { executionPolicySchema, MISSING_HUNTER_UA } from '@/lib/programExecutionPolicy';
import { detectScopeAsset } from '@/lib/scopeAssets';
import { scopeReviewChecks, suggestTestAccountHost, targetReviewSchema, type DocumentedAsset, type TargetReview } from '@/lib/targetReview';
import type { ProgramData } from '@/lib/targetFormData';
import { captureCampaignSource, type CampaignSource } from '@/lib/campaignSource';
import type { ProgramPreview } from '@/server/programImport/normalize';
import { Button } from '@/components/ui/Button';
import { fieldClass, initialReview, lines, policyFields, readable, TargetScopeReview } from './TargetScopeReview';

type Platform = (typeof BOUNTY_PLATFORMS)[number];
type Import = { preview: ProgramPreview } | { message: string };
const levels = ['Low', 'Medium', 'High', 'Critical'] as const;
const accountRoles = ['A', 'B'] as const;
const policyShape = executionPolicySchema.omit({ sourceSnapshot: true });
const policyFieldHelp: Record<string, string> = {
  requestsPerSecond: 'Enter a rate from 0.01 to 100 requests per second.',
  maxConcurrency: 'Enter a whole number from 1 to 32 for maximum concurrent requests.',
  requiredHeaders: 'Enter unique, non-reserved headers in Name: value format.',
  requiredUserAgent: 'Enter a printable User-Agent up to 512 characters, or leave it blank to use your default.',
};

export default function TargetEditor({ program, hunterHasUserAgent, importProgram }: {
  program?: ProgramData;
  hunterHasUserAgent: boolean;
  importProgram?: (url: string, platform: Platform | '') => Promise<Import>;
}) {
  const router = useRouter();
  const [url, setUrl] = useState(program?.programUrl ?? '');
  const [name, setName] = useState(program?.companyName ?? '');
  const [platform, setPlatform] = useState<Platform | ''>((program?.platform ?? '') as Platform | '');
  const [importSource, setImportSource] = useState<CampaignSource>();
  const [source, setSource] = useState(program?.executionPolicies?.[0]?.policy.sourceSnapshot.sourceDocument ?? program?.rulesOfEngagement ?? '');
  const [review, setReview] = useState(() => initialReview(program));
  const [candidates, setCandidates] = useState<DocumentedAsset[]>([]);
  const [nonQualifying, setNonQualifying] = useState<string[]>(program?.nonQualifying ?? []);
  const [qualifying, setQualifying] = useState<string[]>(program?.qualifying ?? []);
  const [legacyExclusions, setLegacyExclusions] = useState(program?.outOfScope.join('\n') ?? '');
  const [accountAssets, setAccountAssets] = useState({ A: '', B: '' });
  const [accountLogins, setAccountLogins] = useState({ A: '', B: '' });
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const busy = importing || saving;

  async function loadPreview() {
    if (!importProgram) return;
    setImporting(true); setMessage(''); setError('');
    try {
      const result = await importProgram(url.trim(), platform);
      if ('message' in result) { setMessage(result.message); return; }
      const { preview } = result;
      const capturedSource = captureCampaignSource(preview);
      setUrl(preview.url);
      setName(preview.name);
      setPlatform(preview.platform);
      setSource(preview.policy.sourceSnapshot.rules);
      setImportSource(capturedSource);
      setNonQualifying(preview.nonQualifying);
      setCandidates(preview.unrepresentedAssets);
      const assetLabels = new Map([...preview.scopeIn, ...preview.scopeOut, ...preview.nonAutomatable, ...preview.unrepresentedAssets]
        .map(asset => [asset.ref, asset.originalValue ?? asset.sourceType]));
      setReview({
        ...initialReview(),
        scopeIn: preview.scopeIn.flatMap(asset => {
          if (!asset.normalizedValue) return [];
          const detected = detectScopeAsset(asset.normalizedValue);
          return [{ value: detected.normalizedValue, type: /^(?:api)$/i.test(asset.sourceType) ? 'API' : detected.inferredType }];
        }),
        exclusions: preview.policy.exclusions.join('\n'),
        userAgent: preview.policy.requiredUserAgent ?? '',
        headers: (preview.policy.requiredHeaders ?? []).map(({ name, value }) => name + ': ' + value).join('\n'),
        ...(preview.policy.requestsPerSecond != null ? { requests: String(preview.policy.requestsPerSecond) } : {}),
        ...(preview.policy.maxConcurrency != null ? { concurrency: String(preview.policy.maxConcurrency) } : {}),
        forbidden: preview.policy.forbiddenCategories ?? [],
        documentedAssets: [...preview.nonAutomatable, ...preview.scopeOut.filter(asset => !preview.policy.exclusions.includes(asset.normalizedValue ?? ''))],
        rules: preview.unrepresentedRules.map(rule => ({ ...rule, decision: null, assetLabel: rule.assetRef ? assetLabels.get(rule.assetRef) : undefined })),
      });
      setMessage('Import ready for review. Check the scope and resolve the program rules before enabling automation.');
    } catch { setMessage('Import is unavailable. Enter the scope and rules manually.'); }
    finally { setImporting(false); }
  }

  const policy = policyFields(review);
  const { scopeError, conflict } = scopeReviewChecks(review.scopeIn, policy.exclusions);
  const accountSuggestions = {
    A: suggestTestAccountHost(review.scopeIn, policy.exclusions, accountLogins.A),
    B: suggestTestAccountHost(review.scopeIn, policy.exclusions, accountLogins.B),
  };
  const accountNeedsHost = Boolean(accountSuggestions.A || accountSuggestions.B);
  const policyResult = policyShape.safeParse(policy);
  const legacy = program?.legacyPolicyReview;
  const legacyMismatch = legacy && legacyExclusions === program?.outOfScope.join('\n') &&
    (legacy.unconvertible.length || legacy.exclusions.some(value => !policy.exclusions.some(exclusion => {
      try { return detectScopeAsset(exclusion).normalizedValue === value; } catch { return false; }
    })));
  const issue = policyResult.error?.issues[0];
  const policyIssue = issue ? policyFieldHelp[String(issue.path[0])] ?? issue.message
    : review.pendingRule.trim() || review.rules.some(rule => !rule.decision) ? 'Resolve each unrepresented rule to enable automation.'
    : !review.automation ? 'Automation is disabled. Enable it after reviewing the rules and scope.'
    : !policy.requiredUserAgent && !hunterHasUserAgent ? MISSING_HUNTER_UA
    : legacyMismatch ? 'Add matching structured exclusions or correct the legacy list below.' : '';

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || scopeError || conflict || accountNeedsHost || !policyResult.success) return;
    const form = new FormData(event.currentTarget);
    const field = (key: string) => String(form.get(key) ?? '').trim();
    const testAccounts: TargetReview['testAccounts'] = [];
    for (const role of accountRoles) {
      const asset = field('asset-' + role);
      const loginUrl = field('login-' + role);
      const username = field('username-' + role);
      const password = String(form.get('password-' + role) ?? '');
      if (asset || loginUrl || username || password) testAccounts.push({ asset, loginUrl, username, password, purpose: role === 'A' ? 'ACCOUNT_A' : 'ACCOUNT_B' });
    }
    const pendingDocument = review.pendingDocument.trim();
    const pendingRule = review.pendingRule.trim();
    const checked = targetReviewSchema.safeParse({
      scopeIn: review.scopeIn,
      documentedAssets: [...review.documentedAssets, ...candidates,
        ...(pendingDocument ? [{ ref: 'manual:' + pendingDocument, originalValue: pendingDocument, sourceType: 'Manual' }] : [])]
        .map(({ ref, originalValue, sourceType, reason }: DocumentedAsset) => ({ ref, originalValue, sourceType, reason })),
      rules: [...review.rules, ...(pendingRule ? [{ text: pendingRule, decision: null }] : [])],
      policy, testAccounts, expectedAssets: program?.expectedAssets,
      sourceDocument: !program && source ? source : undefined,
      importSource: !program && importSource?.url === url.trim() && importSource.platform === platform ? importSource : undefined,
      campaignInterval: program ? (field('campaignHours') ? Number(field('campaignHours')) * 60 : null) : undefined,
    });
    if (!checked.success) {
      setError(checked.error.issues.map(issue => issue.path.join('.') + ' — ' + issue.message).join(' '));
      return;
    }
    setSaving(true); setError('');
    const body = {
      companyName: name.trim(), platform: platform || null, programUrl: url.trim() || null,
      rewardCurrency: field('rewardCurrency'),
      ...Object.fromEntries(levels.map(level => ['reward' + level, field('reward' + level) || null])),
      qualifying, nonQualifying, targetReview: checked.data,
      ...(!program ? { startCampaign: true } : {}),
      ...(program ? {
        expectedUpdatedAt: program.updatedAt,
        expectedPolicyVersion: program.executionPolicies?.[0]?.version ?? 0,
        expectedLegacyScopeFingerprint: legacy?.scopeFingerprint,
        ...(legacyExclusions !== program.outOfScope.join('\n') ? { outOfScope: lines(legacyExclusions) } : {}),
      } : {}),
    };
    try {
      const response = await fetch(program ? '/api/programs/' + program.id : '/api/programs', {
        method: program ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not save target.');
      const cleanup = response.headers.has('X-Scope-Cleanup-Pending') ? '&cleanup=pending' : '';
      router.push('/targets/' + result.id + (program ? '?saved=1' + cleanup : ''));
      router.refresh();
    } catch (failure) { setError((failure as Error).message); setSaving(false); }
  }

  return <form className="max-w-3xl space-y-5" onSubmit={save} aria-busy={busy} onInvalidCapture={event => {
    let parent = event.target instanceof HTMLElement ? event.target.parentElement : null;
    while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; }
  }}>
    <fieldset disabled={busy} className="space-y-5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-52 flex-1">Program URL<input type="url" className={fieldClass} value={url} onChange={event => {
          setUrl(event.target.value);
          setReview(previous => ({ ...previous, automation: false }));
        }} placeholder="https://hackerone.com/program-name" /></label>
        {importProgram && <Button variant="secondary" disabled={!url.trim()} onClick={loadPreview}>{importing ? 'Importing…' : 'Import'}</Button>}
      </div>
      {message && <p role="status" className="rounded border border-border p-3 text-sm">{message}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label>Name<input className={fieldClass} required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label>
        <label>Platform<select aria-label="Platform" className={fieldClass} value={platform} onChange={event => {
          setPlatform(event.target.value as Platform | '');
          setReview(previous => ({ ...previous, automation: false }));
          if (event.target.value === 'PRIVATE') setMessage('Manual entry. Add the authorized scope and program rules below.');
        }}>
          <option value="">Choose platform</option>
          {BOUNTY_PLATFORMS.map(item => <option key={item} value={item}>{platformLabel(item)}</option>)}
        </select></label>
      </div>
      {Boolean(program?.campaign?.pendingAssets.length) && <section id="scope-import-review" className="scroll-mt-24 space-y-2 rounded border border-border p-4">
        <h2 className="font-semibold">New assets to review</h2>
        <p className="text-sm text-muted">Add each authorized asset to the scope below, then save to confirm it.</p>
        {program!.campaign!.pendingAssets.map(asset => {
          const included = review.scopeIn.some(row => row.value === asset.value);
          return <div key={asset.value} className="flex flex-wrap items-center gap-2"><span className="break-all">{asset.value}</span>
            <Button size="sm" variant="secondary" disabled={included} onClick={() =>
              setReview(current => ({ ...current, scopeIn: [...current.scopeIn, asset] }))}>{included ? 'Added to review' : 'Add to scope'}</Button>
          </div>;
        })}
      </section>}
      <TargetScopeReview value={review} onChange={setReview} historical={program?.historicalDocumentedAssets} candidates={candidates} />
      {legacy?.scopes.length ? <details className="ui-disclosure"><summary>Legacy Scope text</summary>
        {legacy.scopes.map(scope => <div key={scope.id} className="mt-3 space-y-2">
          <p className="font-medium">Scope {scope.id}</p>
          {[scope.scopeDetails, scope.outOfScope, scope.rulesOfEngagement].map((text, index) => text && <p key={index} className="whitespace-pre-wrap break-words text-sm">{text}</p>)}
        </div>)}
      </details> : null}
      {program?.outOfScope.length ? <details className="ui-disclosure" open={Boolean(legacyMismatch)}><summary>Legacy exclusions</summary>
        <label className="mt-3 block">Legacy out-of-scope domains<textarea className={fieldClass} value={legacyExclusions} onChange={event => setLegacyExclusions(event.target.value)} /></label>
        {legacy?.unconvertible.map(({ index, value, reason }) => <p key={index} className="text-sm text-danger">{value} — {reason}</p>)}
      </details> : null}
      <details className="ui-disclosure"><summary>Non-qualifying vulnerabilities{nonQualifying.length ? ' · ' + nonQualifying.map(readable).join(', ') : ''}</summary>
        <div className="mt-3"><Families label="Vulnerability families excluded by the program" value={nonQualifying} change={setNonQualifying} /></div>
      </details>
      <details className="ui-disclosure"><summary>Test accounts <span className="text-muted">(optional)</span></summary>
        <p className="my-3 text-sm text-muted">Two accounts on the same asset are recommended for access-control tests. Credentials are encrypted on save.</p>
        {program?.testAccounts?.map(account => <p key={account.id} className="text-sm">{account.label} · {account.asset}</p>)}
        {accountRoles.map(role => <fieldset key={role} className="my-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
          <legend>Account {role}</legend>
          <label>Asset<select name={'asset-' + role} className={fieldClass} value={accountAssets[role]} onChange={event =>
            setAccountAssets({ ...accountAssets, [role]: event.target.value })}><option value="">Choose an exact in-scope asset</option>
            {[...new Set(review.scopeIn.map(row => row.value).filter(accountAsset))].map(value => <option key={value}>{value}</option>)}
          </select></label>
          <label>Login URL<input name={'login-' + role} className={fieldClass} type="url" placeholder="https://app.example.com/login"
            value={accountLogins[role]} onChange={event => setAccountLogins({ ...accountLogins, [role]: event.target.value })} /></label>
          {accountSuggestions[role] && <div className="space-y-2 sm:col-span-2">
            <p className="text-sm text-muted">The wildcard covers this login. Add its exact host to attach the test account.</p>
            <Button size="sm" variant="secondary" onClick={() => {
              const host = accountSuggestions[role]!;
              setReview(current => ({ ...current, scopeIn: [...current.scopeIn, { value: host, type: 'WEB_APPLICATION' }] }));
              setAccountAssets(current => ({ ...current, [role]: host }));
            }}>Add {accountSuggestions[role]} to scope</Button>
          </div>}
          <label>Username<input name={'username-' + role} className={fieldClass} autoComplete="off" maxLength={512} /></label>
          <label>Password<input name={'password-' + role} className={fieldClass} type="password" autoComplete="new-password" maxLength={512} /></label>
        </fieldset>)}
      </details>
      {program && <section id="campaign-schedule" className="space-y-2 rounded border border-border p-4">
        <h2 className="font-semibold">Campaign schedule</h2>
        <label className="block">Hours between follow-up cycles<input name="campaignHours" className={fieldClass} type="number" min="1" max="720" step="1" defaultValue={program.campaign?.intervalMinutes ? program.campaign.intervalMinutes / 60 : ''} /></label>
        <p className="text-sm text-muted">Leave blank to disable scheduled cycles. A follow-up only tests new or modified assets.</p>
      </section>}
      <details className="ui-disclosure"><summary>Advanced</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-5">
          {levels.map(level => <label key={level}>Reward {readable(level)}<input name={'reward' + level} inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" className={fieldClass} defaultValue={program?.['reward' + level as `reward${typeof level}`] ?? ''} /></label>)}
          <label>Currency<input name="rewardCurrency" className={fieldClass} required maxLength={3} pattern="[A-Z]{3}" defaultValue={program?.rewardCurrency ?? 'EUR'} /></label>
        </div>
        {source && <details className="mt-3"><summary>Source rules</summary><p className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-sm">{source}</p></details>}
        <div className="mt-3"><Families label="Qualifying vulnerabilities" value={qualifying} change={setQualifying} /></div>
      </details>
      <section aria-label="Review checks" className="space-y-2 rounded border border-border p-4">
        <h2 className="font-semibold">Review checks</h2>
        <Check label="Valid scope" issue={scopeError || (!review.scopeIn.length ? 'Add an authorized asset to make this target ready.' : '')} />
        <Check label="No in/out conflict" issue={conflict} />
        <Check label="Execution policy applicable" issue={policyIssue} />
      </section>
      {error && <p role="alert" className="text-danger">{error}</p>}
      <div className="flex items-center justify-end gap-3">
        <Link href={program ? '/targets/' + program.id : '/targets'} className="text-sm text-muted">Cancel</Link>
        <Button type="submit" disabled={busy || Boolean(scopeError || conflict) || accountNeedsHost || !policyResult.success}>{saving ? 'Saving…' : program ? 'Save' : 'Save and start'}</Button>
      </div>
    </fieldset>
  </form>;
}

function accountAsset(value: string) {
  try { const asset = detectScopeAsset(value); return asset.executable && asset.format !== 'WILDCARD_DOMAIN'; }
  catch { return false; }
}

function Check({ label, issue }: { label: string; issue?: string }) {
  return <p className="text-sm"><strong>{label}</strong> · <span className={issue ? 'text-danger' : 'text-muted'}>{issue || 'Pass'}</span></p>;
}

function Families({ label, value, change }: { label: string; value: string[]; change: (value: string[]) => void }) {
  return <fieldset><legend className="font-medium">{label}</legend>
    <div className="grid grid-cols-2 gap-1">{VULNERABILITY_FAMILIES.map(family => <label key={family} className="text-sm">
      <input type="checkbox" checked={value.includes(family)} onChange={event =>
        change(event.target.checked ? [...value, family] : value.filter(item => item !== family))} /> {readable(family)}
    </label>)}</div>
  </fieldset>;
}
