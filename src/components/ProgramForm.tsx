"use client";
import {platformLabel} from '@/lib/platformPresentation';
import { useState } from "react";
import { BOUNTY_PLATFORMS, VULNERABILITY_FAMILIES } from "@/lib/bountyProgram";
import { headersFromLines, LEGACY_LIMITS, policyDraftNeedsReview, POLICY_REVIEW_ANCHOR, TEST_CATEGORIES, type LegacyScopeText, type StoredExecutionPolicy } from '@/lib/programExecutionPolicy';
import { Button } from "@/components/ui/Button";

export interface ProgramData {
  executionPolicies?: { version: number; policy: StoredExecutionPolicy }[];
  legacyPolicyReview?: {
    scopes: LegacyScopeText[];
    scopeFingerprint: string;
    scopeChanged: boolean;
    exclusions: string[];
    unconvertible: { index: number; value: string; reason: string }[];
    unrepresentedRules: string[];
  };
  assessmentMode?: 'BLACK_BOX'|'WHITE_BOX';
  updatedAt?:string;
  id: string; companyName: string; platform: string | null; programUrl: string | null;
  rewardCurrency: string; rewardLow: string | null; rewardMedium: string | null; rewardHigh: string | null; rewardCritical: string | null;
  requiredUserAgent: string; outOfScope: string[]; qualifying: string[]; nonQualifying: string[];
  scopeRules: string[]; rulesOfEngagement: string | null; deletingAt?: string | null;
  targets: { id: string; host: string; active: boolean }[];
  _count?: { scopeAssets: number };
}
const inputClass = "mt-1 w-full rounded border border-border bg-surface p-2";
function Hosts({ title, value, onChange }: { title: string; value: string[]; onChange: (v: string[]) => void }) {
  return <fieldset id={title==='Out of scope'?'out-of-scope':undefined} className="space-y-2"><legend className="font-semibold">{title}</legend>
    {value.map((host, i) => <div className="flex gap-2" key={i}><input aria-label={`${title} FQDN ${i + 1}`} required placeholder="api.example.com" className={inputClass} value={host} onChange={e => onChange(value.map((v, n) => n === i ? e.target.value : v))} /><Button className="shrink-0" variant="ghost" onClick={() => onChange(value.filter((_, n) => n !== i))}>Remove</Button></div>)}
    <Button variant="secondary" onClick={() => onChange([...value, ""])}>+ Add host</Button>
  </fieldset>;
}
export default function ProgramForm({ initial, onSaved, onCancel }: { initial?: ProgramData; onSaved: (id: string) => void; onCancel?: () => void }) {
  const currentPolicy = initial?.executionPolicies?.[0];
  const policy = currentPolicy?.policy;
  const legacy = initial?.legacyPolicyReview;
  const draft = policyDraftNeedsReview(policy?.reviewState);
  const [configurePolicy, setConfigurePolicy] = useState(Boolean(currentPolicy || legacy?.unrepresentedRules.length));
  const [automationAllowed, setAutomationAllowed] = useState(Boolean(policy?.automationAllowed && !draft && !legacy?.scopeChanged));
  const unrepresented = [...new Set([...(policy?.sourceSnapshot.unrepresentedRules ?? []),
    ...(!policy || legacy?.scopeChanged ? legacy?.unrepresentedRules ?? [] : [])])];
  const structuredExclusions = [...new Set([...(policy?.exclusions ?? []), ...(legacy?.exclusions ?? [])])];
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [outOfScope, setOutOfScope] = useState(initial?.outOfScope ?? []);
  const [qualifying, setQualifying] = useState(initial?.qualifying ?? []);
  const [nonQualifying, setNonQualifying] = useState(initial?.nonQualifying ?? []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError("");
    const form = new FormData(e.currentTarget);
    const data = Object.fromEntries(form);
    const field = (name: string) => String(form.get(name) ?? '').trim();
    const lines = (name: string) => field(name).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const executionPolicy = initial && configurePolicy ? {
      automationAllowed: form.has('automationAllowed'),
      requiredUserAgent: field('requiredUserAgent') || null,
      requiredHeaders: headersFromLines(field('requiredHeaders')),
      exclusions: lines('structuredExclusions'),
      requestsPerSecond: Number(field('requestsPerSecond')),
      maxConcurrency: Number(field('maxConcurrency')),
      forbiddenCategories: form.getAll('forbiddenCategories'),
      sourceSnapshot: { url: data.programUrl || null, rules: field('rulesOfEngagement'), unrepresentedRules: lines('unrepresentedRules') },
    } : undefined;
    // Leave unchanged historical values intact, including entries that predate FQDN validation.
    if (initial && field('rulesOfEngagement') === (initial.rulesOfEngagement?.trim() ?? '')) delete data.rulesOfEngagement;
    const legacyExclusionsChanged = JSON.stringify(outOfScope) !== JSON.stringify(initial?.outOfScope);
    const body = initial ? { ...data, ...(initial?.updatedAt?{expectedUpdatedAt:initial.updatedAt}:{}), platform: data.platform || null, programUrl: data.programUrl || null,
      ...Object.fromEntries(["rewardLow", "rewardMedium", "rewardHigh", "rewardCritical"].map(k => [k, data[k] || null])),
      requiredUserAgent: field('requiredUserAgent'), executionPolicy,
      expectedPolicyVersion: currentPolicy?.version ?? 0, expectedLegacyScopeFingerprint: legacy?.scopeFingerprint,
      ...(legacyExclusionsChanged ? { outOfScope } : {}), qualifying, nonQualifying } : { companyName: data.companyName, platform: data.platform || null, programUrl: data.programUrl || null };
    try {
      const res = await fetch(initial ? `/api/programs/${initial.id}` : "/api/programs", { method: initial ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json(); if (!res.ok) throw new Error(json.error); onSaved(json.id);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const families = (title: string, values: string[], set: (v: string[]) => void) => <fieldset><legend className="mb-2 font-semibold">{title} <span className="font-normal text-muted">(optional)</span></legend><div className="grid gap-2 sm:grid-cols-3">{VULNERABILITY_FAMILIES.map(f => <label key={f} className="text-sm"><input type="checkbox" checked={values.includes(f)} onChange={e => set(e.target.checked ? [...values, f] : values.filter(v => v !== f))} /> {f.replaceAll("_", " ")}</label>)}</div></fieldset>;
  if (!initial) return <form className="space-y-5" onSubmit={submit} onInvalidCapture={e=>{let parent=e.target instanceof HTMLElement?e.target.parentElement:null;while(parent){if(parent instanceof HTMLDetailsElement)parent.open=true;parent=parent.parentElement;}}} aria-busy={busy}>
    <label className="block text-sm font-medium">Name<input data-autofocus autoFocus required name="companyName" maxLength={200} className={inputClass} /></label>
    <label className="block text-sm font-medium">Platform<select name="platform" className={inputClass}><option value="">Select platform</option>{BOUNTY_PLATFORMS.map(p => <option key={p} value={p}>{platformLabel(p)}</option>)}</select></label>
    <label className="block text-sm font-medium">Program URL <span className="font-normal text-muted">(optional)</span><input name="programUrl" type="url" className={inputClass} /></label>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {busy && <p role="status" className="text-sm text-muted">Creating target…</p>}
    <div className="flex justify-end gap-3 pt-2"><Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create target"}</Button></div>
  </form>;
  return <form className="max-w-2xl space-y-6" onSubmit={submit} onInvalidCapture={e=>{let parent=e.target instanceof HTMLElement?e.target.parentElement:null;while(parent){if(parent instanceof HTMLDetailsElement)parent.open=true;parent=parent.parentElement;}}} aria-busy={busy}>
    <label className="block">Company / program name *<input autoFocus={!initial} required name="companyName" maxLength={200} defaultValue={initial?.companyName} className={inputClass} /></label>
    <label className="block">Platform<select aria-label="Platform" name="platform" defaultValue={initial?.platform ?? ""} className={inputClass}><option value="">Choose platform</option>{BOUNTY_PLATFORMS.map(p => <option key={p} value={p}>{platformLabel(p)}</option>)}</select></label>
    <label className="block">Program URL<input name="programUrl" type="url" defaultValue={initial?.programUrl ?? ""} onChange={() => setAutomationAllowed(false)} className={inputClass} /></label>
    <details className="ui-disclosure"><summary>Rewards</summary><fieldset className="mt-4"><legend className="sr-only">Rewards</legend><div className="grid gap-3 sm:grid-cols-5">{(["Low", "Medium", "High", "Critical"] as const).map(level => <label key={level}>{level}<input name={`reward${level}`} inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" defaultValue={initial?.[`reward${level}`] ?? ""} className={inputClass} /></label>)}<label>Currency<input name="rewardCurrency" required pattern="[A-Z]{3}" maxLength={3} defaultValue={initial?.rewardCurrency ?? "EUR"} className={inputClass} /></label></div></fieldset></details>
    <details id={POLICY_REVIEW_ANCHOR} className="ui-disclosure" open><summary>Authorization policy</summary><div className="mt-4 space-y-5">
    <p className="text-sm text-muted">Manage authorized assets in scope. Exclusions below take priority.</p>
    <label className="block">Rules of engagement<textarea name="rulesOfEngagement" maxLength={20000} rows={5} defaultValue={initial?.rulesOfEngagement ?? ''} onChange={() => setAutomationAllowed(false)} className={inputClass} placeholder="Official program rules, technical restrictions, authorization conditions…" /></label>
    <Hosts title="Out of scope" value={outOfScope} onChange={value => { setOutOfScope(value); setAutomationAllowed(false); }} />
    {legacy?.scopes.length ? <details className="ui-disclosure" open={draft || legacy.scopeChanged}>
      <summary>Legacy Scope text</summary>
      {legacy.scopes.map(scope => <div key={scope.id} className="mt-3 space-y-2">
        <p className="text-sm font-medium">Scope {scope.id}</p>
        {([['Scope details', scope.scopeDetails], ['Out of scope', scope.outOfScope], ['Rules of engagement', scope.rulesOfEngagement]] as const).map(([label, value]) =>
          value && <p key={label} className="whitespace-pre-wrap break-words text-sm"><strong>{label}</strong>{'\n'}{value}</p>)}
      </div>)}
    </details> : null}
    {legacy?.unconvertible.length ? <ul className="list-disc pl-5 text-sm text-danger">
      {legacy.unconvertible.map(({ index, value, reason }) => <li key={index}>Legacy exclusion {index + 1} <code>{value}</code> cannot be converted. {reason}</li>)}
    </ul> : null}
    {!currentPolicy && <label className="block"><input type="checkbox" checked={configurePolicy} onChange={e => setConfigurePolicy(e.target.checked)} /> Configure structured execution policy</label>}
    {configurePolicy && <fieldset className="space-y-3">
      <legend className="font-semibold">Execution policy {currentPolicy && <span className="text-muted">(version {currentPolicy.version})</span>}</legend>
      {draft && <p role="status" className="text-sm">Imported draft. Review the source rules and set the limits before allowing automation.</p>}
      <label className="block"><input type="checkbox" name="automationAllowed" checked={automationAllowed} onChange={e => setAutomationAllowed(e.target.checked)} /> Allow automation. I verified that all applicable rules are represented.</label>
      <label className="block">Rules the engine cannot enforce<textarea name="unrepresentedRules" rows={2} defaultValue={unrepresented.join('\n')} className={inputClass} /><span className="text-sm text-muted">One per line. Any entry blocks automation.</span></label>
      <label className="block">Structured exclusions<textarea name="structuredExclusions" rows={3} defaultValue={structuredExclusions.join('\n')} placeholder="https://example.com/admin/*" className={inputClass} /><span className="text-sm text-muted">One URL, domain, wildcard, IP or CIDR per line.</span></label>
      <label className="block">Required headers<textarea name="requiredHeaders" rows={2} defaultValue={policy?.requiredHeaders.map(({ name, value }) => name + ': ' + value).join('\n')} placeholder="X-Bug-Bounty: your-username" className={inputClass} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>Requests per second<input required name="requestsPerSecond" type="number" min="0.01" max="100" step="0.01" defaultValue={draft ? policy?.requestsPerSecond ?? '' : policy?.requestsPerSecond ?? LEGACY_LIMITS.requestsPerSecond} className={inputClass} /></label>
        <label>Maximum concurrent requests<input required name="maxConcurrency" type="number" min="1" max="32" defaultValue={draft ? policy?.maxConcurrency ?? '' : policy?.maxConcurrency ?? LEGACY_LIMITS.maxConcurrency} className={inputClass} /></label>
      </div>
      <fieldset className="space-y-1"><legend>Forbidden test categories</legend>
        {TEST_CATEGORIES.map(category => <label key={category} className="block text-sm"><input type="checkbox" name="forbiddenCategories" value={category} defaultChecked={policy?.forbiddenCategories.includes(category)} /> {category.toLowerCase().replaceAll('_', ' ')}</label>)}
      </fieldset>
    </fieldset>}
    </div></details>
    <details className="ui-disclosure"><summary>Vulnerability policy</summary><div className="mt-4 space-y-5">
    {families("Qualifying vulnerabilities", qualifying, setQualifying)}
    <p className="text-sm text-muted">These fields record program policy for research. They do not select automated tests. Explicit exclusions always take priority.</p>
    {families("Non-qualifying vulnerabilities", nonQualifying, setNonQualifying)}
    </div></details>
    <details className="ui-disclosure"><summary>Advanced</summary><div className="mt-4">
    <label className="block">Required User-Agent<input name="requiredUserAgent" maxLength={512} placeholder="Required by the program" defaultValue={(policy ? policy.requiredUserAgent : initial.requiredUserAgent) ?? ''} className={inputClass} /><span className="text-sm text-muted">Leave blank to use your default hunter User-Agent from Settings.</span></label>
    </div></details>
    {error && <p role="alert" className="text-danger">{error}</p>}
    {busy&&<p role="status">Saving target settings…</p>}
    <Button type="submit" disabled={busy}>{busy ? "Saving…" : initial ? "Save target" : "Create target"}</Button>
  </form>;
}
