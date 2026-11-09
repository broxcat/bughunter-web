'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { BOUNTY_PLATFORMS, VULNERABILITY_FAMILIES } from '@/lib/bountyProgram';
import { platformLabel } from '@/lib/platformPresentation';
import { executionPolicySchema, hasHunterTemplate, MISSING_HUNTER_UA, MISSING_HUNTER_USERNAME } from '@/lib/programExecutionPolicy';
import { intakePreviewSchema, MAX_PROGRAM_SOURCE, splitNonQualifying, type IntakeInput } from '@/lib/programIntake';
import { detectScopeAsset } from '@/lib/scopeAssets';
import { scopeReviewChecks, targetReviewSchema } from '@/lib/targetReview';
import type { ProgramData } from '@/lib/targetFormData';
import { campaignSourceSchema, type CampaignSource } from '@/lib/campaignSource';
import { Button } from '@/components/ui/Button';
import { fieldClass, initialReview, lines, policyFields, readable, TargetScopeReview } from './TargetScopeReview';

type Platform = (typeof BOUNTY_PLATFORMS)[number];
const levels = ['Low', 'Medium', 'High', 'Critical'] as const;
const policyShape = executionPolicySchema.omit({ sourceSnapshot: true });

export default function TargetEditor({ program, hunterHasUserAgent, hunterHasUsername, hasAi }: {
  program?: ProgramData;
  hunterHasUserAgent: boolean;
  hunterHasUsername: boolean;
  hasAi: boolean;
}) {
  const router = useRouter();
  const [url, setUrl] = useState(program?.programUrl ?? '');
  const [name, setName] = useState(program?.companyName ?? '');
  const [platform, setPlatform] = useState<Platform | ''>((program?.platform ?? '') as Platform | '');
  const [markdown, setMarkdown] = useState('');
  const [importSource, setImportSource] = useState<CampaignSource>();
  const [sourceDocument, setSourceDocument] = useState<string>();
  const [importedFrom, setImportedFrom] = useState<{ url: string; platform: Platform | '' }>();
  const [review, setReview] = useState(() => initialReview(program));
  const stored = program?.executionPolicies?.[0]?.policy;
  const [nonQualifying, setNonQualifying] = useState([
    ...(program?.nonQualifying ?? []), ...(stored?.sourceSnapshot.nonQualifyingText ?? []),
  ].join('\n'));
  const [qualifying, setQualifying] = useState<string[]>(program?.qualifying ?? []);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showSettings, setShowSettings] = useState(!hasAi);
  const busy = importing || saving;

  async function loadPreview(input: IntakeInput) {
    setImporting(true); setMessage(''); setError('');
    try {
      const response = await fetch('/api/programs/import-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.settings) setShowSettings(true);
        throw new Error(result.error ?? 'Program extraction is unavailable.');
      }
      const { data: preview } = intakePreviewSchema.safeParse(result.preview);
      if (!preview) throw new Error('The extraction was invalid. Your form was kept as entered.');
      const extractedUrl = preview.url ?? url;
      const extractedPlatform = preview.platform ?? platform;
      setUrl(extractedUrl);
      setName(preview.name);
      setPlatform(extractedPlatform);
      setSourceDocument(preview.sourceDocument);
      if (input.mode === 'url') setMarkdown('');
      setImportSource(campaignSourceSchema.safeParse(result.source).data);
      setImportedFrom({ url: extractedUrl.trim(), platform: extractedPlatform });
      setNonQualifying(preview.nonQualifying.join('\n'));
      setReview(previous => ({
        scopeIn: preview.scopeIn, exclusions: preview.policy.exclusions.join('\n'), userAgent: preview.policy.requiredUserAgent ?? '',
        policy: preview.policy, documentedAssets: [...new Map([...previous.documentedAssets, ...preview.documentedAssets].map(asset => [asset.ref, asset])).values()],
        rules: [
          ...previous.rules.filter(rule => !rule.origin),
          ...preview.unresolved.map(text => ({ text, decision: null, origin: 'AI_INTAKE' as const })),
        ],
      }));
      setMessage('Extraction ready for review.' + (preview.omitted.length ? ' Omitted assets without a verified in-scope entry: ' + preview.omitted.join(', ') + '.' : ''));
    } catch (failure) { setError((failure as Error).message); }
    finally { setImporting(false); }
  }

  const policy = policyFields(review);
  const { scopeError, conflict } = scopeReviewChecks(review.scopeIn, policy.exclusions);
  const policyResult = policyShape.safeParse(policy);
  const legacy = program?.legacyPolicyReview;
  const legacyMismatch = Boolean(legacy && (legacy.unconvertible.length || legacy.exclusions.some(value => !policy.exclusions.some(exclusion => {
    try { return detectScopeAsset(exclusion).normalizedValue === value; } catch { return false; }
  }))));
  const association = importedFrom ?? (stored?.sourceSnapshot.sourceDocument ? { url: program?.programUrl ?? '', platform: program?.platform ?? '' } : null);
  const changedSource = Boolean(association && (association.url !== url.trim() || association.platform !== platform));
  const unreviewedMarkdown = Boolean(markdown.trim() && markdown !== sourceDocument);
  const unresolved = review.rules.filter(rule => !rule.decision).length;
  const needsUsername = [policy.requiredUserAgent ?? '', ...policy.requiredHeaders.map(header => header.value)].some(hasHunterTemplate) && !hunterHasUsername;
  const policyIssue = !policyResult.success ? (policyResult.error.issues[0]?.message ?? 'Invalid execution policy.')
    : changedSource ? 'Extract the program rules again after changing its URL or platform.'
    : unreviewedMarkdown ? 'Extract the pasted Markdown before running automation.'
    : unresolved ? unresolved + (unresolved === 1 ? ' program rule could' : ' program rules could') + ' not be represented safely. Review the source before running automation.'
    : !policy.automationAllowed ? 'The program policy does not allow automation.'
    : needsUsername ? MISSING_HUNTER_USERNAME
    : !policy.requiredUserAgent && !hunterHasUserAgent ? MISSING_HUNTER_UA
    : legacyMismatch ? 'The current exclusions do not cover all retained legacy exclusions.' : '';

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || scopeError || conflict || !policyResult.success || markdown.length > MAX_PROGRAM_SOURCE) return;
    const form = new FormData(event.currentTarget);
    const field = (key: string) => String(form.get(key) ?? '').trim();
    const excluded = splitNonQualifying(lines(nonQualifying));
    const checked = targetReviewSchema.safeParse({
      scopeIn: review.scopeIn, documentedAssets: review.documentedAssets,
      rules: [...review.rules, ...(changedSource && !review.rules.some(rule => rule.origin === 'SOURCE_CHANGED')
        ? [{ text: 'Program URL or platform changed. Extract the current rules before automation.', decision: null, origin: 'SOURCE_CHANGED' }] : []),
      ...(unreviewedMarkdown ? [{ text: 'Pasted Markdown has not been extracted. Review the program rules before automation.', decision: null, origin: 'AI_INTAKE' }] : [])],
      policy, expectedAssets: program?.expectedAssets,
      sourceDocument: unreviewedMarkdown ? markdown : sourceDocument,
      intakeVersion: !program || sourceDocument !== undefined || unreviewedMarkdown ? 1 : undefined,
      nonQualifyingText: excluded.text,
      importSource: !changedSource && !unreviewedMarkdown ? importSource : undefined,
      campaignInterval: field('campaignHours') ? Number(field('campaignHours')) * 60 : null,
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
      qualifying, nonQualifying: excluded.families, targetReview: checked.data,
      ...(!program ? { startCampaign: true } : {
        expectedUpdatedAt: program.updatedAt,
        expectedPolicyVersion: program.executionPolicies?.[0]?.version ?? 0,
        expectedLegacyScopeFingerprint: legacy?.scopeFingerprint,
      }),
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
      <section aria-label="Program source" className="space-y-3 rounded border border-border p-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-52 flex-1">Program URL<input type="url" className={fieldClass} value={url}
            onChange={event => setUrl(event.target.value)} placeholder="https://hackerone.com/program-name" /></label>
          <Button variant="secondary" disabled={!hasAi || !url.trim()} onClick={() => loadPreview({ mode: 'url', url: url.trim() })}>Extract from URL</Button>
        </div>
        <label className="block">Program Markdown<textarea className={fieldClass} rows={5}
          value={markdown} onChange={event => setMarkdown(event.target.value)} placeholder="Paste the program scope and rules here" /></label>
        <Button variant="secondary" disabled={!hasAi || !markdown.trim() || markdown.length > MAX_PROGRAM_SOURCE} onClick={() => loadPreview({ mode: 'markdown', markdown })}>Extract from Markdown</Button>
        {markdown.length > MAX_PROGRAM_SOURCE && <p role="alert" className="text-sm text-danger">Program Markdown exceeds the 64,000-character extraction limit.</p>}
        {showSettings && <p className="text-sm text-muted">Select an AI provider and model in <Link href="/settings" className="text-brand underline">Settings</Link> to extract the program, or fill in the form manually.</p>}
        {hasAi && <p className="text-sm text-muted">Extraction sends the program text to the AI provider selected in Settings.</p>}
        {importing && <p role="status" className="text-sm">Extracting program details…</p>}
        {message && <p role="status" className="break-words text-sm">{message}</p>}
      </section>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>Name<input className={fieldClass} required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label>
        <label>Platform<select aria-label="Platform" className={fieldClass} value={platform}
          onChange={event => setPlatform(event.target.value as Platform | '')}>
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
      <TargetScopeReview value={review} onChange={setReview} />
      <label className="block">Non-qualifying vulnerabilities<textarea className={fieldClass} rows={4} value={nonQualifying}
        onChange={event => setNonQualifying(event.target.value)} />
        <span className="text-sm text-muted">One web vulnerability per line.</span>
      </label>
      <section id="campaign-schedule" className="space-y-2 rounded border border-border p-4">
        <h2 className="font-semibold">Campaign schedule</h2>
        <label className="block">Hours between follow-up cycles<input name="campaignHours" className={fieldClass} type="number" min="1" max="720" step="1"
          defaultValue={program?.campaign?.intervalMinutes ? program.campaign.intervalMinutes / 60 : ''} /></label>
        <p className="text-sm text-muted">Leave blank to disable scheduled cycles. A follow-up only tests new or modified assets.</p>
      </section>
      <details className="ui-disclosure"><summary>Advanced</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-5">
          {levels.map(level => <label key={level}>Reward {readable(level)}<input name={'reward' + level} inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" className={fieldClass} defaultValue={program?.['reward' + level as `reward${typeof level}`] ?? ''} /></label>)}
          <label>Currency<input name="rewardCurrency" className={fieldClass} required maxLength={3} pattern="[A-Z]{3}" defaultValue={program?.rewardCurrency ?? 'EUR'} /></label>
        </div>
        <fieldset className="mt-3"><legend className="font-medium">Qualifying vulnerabilities</legend>
          <div className="grid grid-cols-2 gap-1">{VULNERABILITY_FAMILIES.map(family => <label key={family} className="text-sm">
            <input type="checkbox" checked={qualifying.includes(family)} onChange={event =>
              setQualifying(event.target.checked ? [...qualifying, family] : qualifying.filter(item => item !== family))} /> {readable(family)}
          </label>)}</div>
        </fieldset>
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
        <Button type="submit" disabled={busy || Boolean(scopeError || conflict) || !policyResult.success || markdown.length > MAX_PROGRAM_SOURCE}>{saving ? 'Saving…' : program ? 'Save' : 'Save and start'}</Button>
      </div>
    </fieldset>
  </form>;
}

function Check({ label, issue }: { label: string; issue?: string }) {
  return <p className="text-sm"><strong>{label}</strong> · <span className={issue ? 'text-danger' : 'text-muted'}>{issue || 'Pass'}</span></p>;
}
