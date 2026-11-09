"use client";
import {platformLabel} from '@/lib/platformPresentation';
import { useState } from "react";
import { BOUNTY_PLATFORMS, VULNERABILITY_FAMILIES } from "@/lib/bountyProgram";
import { Button } from "@/components/ui/Button";

export interface ProgramData {
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
  return <fieldset id={title==='Out of Scope'?'out-of-scope':undefined} className="space-y-2"><legend className="font-semibold">{title}</legend>
    {value.map((host, i) => <div className="flex gap-2" key={i}><input aria-label={`${title} FQDN ${i + 1}`} required placeholder="api.example.com" className={inputClass} value={host} onChange={e => onChange(value.map((v, n) => n === i ? e.target.value : v))} /><Button className="shrink-0" variant="ghost" onClick={() => onChange(value.filter((_, n) => n !== i))}>Remove</Button></div>)}
    <Button variant="secondary" onClick={() => onChange([...value, ""])}>+ Add host</Button>
  </fieldset>;
}
export default function ProgramForm({ initial, onSaved, onCancel }: { initial?: ProgramData; onSaved: (id: string) => void; onCancel?: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [outOfScope, setOutOfScope] = useState(initial?.outOfScope ?? []);
  const [qualifying, setQualifying] = useState(initial?.qualifying ?? []);
  const [nonQualifying, setNonQualifying] = useState(initial?.nonQualifying ?? []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const body = initial ? { ...data, ...(initial?.updatedAt?{expectedUpdatedAt:initial.updatedAt}:{}), platform: data.platform || null, programUrl: data.programUrl || null,
      ...Object.fromEntries(["rewardLow", "rewardMedium", "rewardHigh", "rewardCritical"].map(k => [k, data[k] || null])),
      outOfScope, qualifying, nonQualifying } : { companyName: data.companyName, platform: data.platform || null, programUrl: data.programUrl || null, requiredUserAgent: "BugHunter/1.0" };
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
    <label className="block">Company / Program name *<input autoFocus={!initial} required name="companyName" maxLength={200} defaultValue={initial?.companyName} className={inputClass} /></label>
    <label className="block">Platform<select aria-label="Platform" name="platform" defaultValue={initial?.platform ?? ""} className={inputClass}><option value="">Choose platform</option>{BOUNTY_PLATFORMS.map(p => <option key={p} value={p}>{platformLabel(p)}</option>)}</select></label>
    <label className="block">Program URL<input name="programUrl" type="url" defaultValue={initial?.programUrl ?? ""} className={inputClass} /></label>
    <details className="ui-disclosure"><summary>Rewards</summary><fieldset className="mt-4"><legend className="sr-only">Rewards</legend><div className="grid gap-3 sm:grid-cols-5">{(["Low", "Medium", "High", "Critical"] as const).map(level => <label key={level}>{level}<input name={`reward${level}`} inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" defaultValue={initial?.[`reward${level}`] ?? ""} className={inputClass} /></label>)}<label>Currency<input name="rewardCurrency" required pattern="[A-Z]{3}" maxLength={3} defaultValue={initial?.rewardCurrency ?? "EUR"} className={inputClass} /></label></div></fieldset></details>
    <details className="ui-disclosure" open><summary>Authorization policy</summary><div className="mt-4 space-y-5">
    <p className="text-sm text-muted">Manage authorized assets in Scope. Exclusions below take priority.</p>
    <label className="block">Rules of engagement<textarea name="rulesOfEngagement" maxLength={20000} rows={5} defaultValue={initial?.rulesOfEngagement ?? ''} className={inputClass} placeholder="Official program rules, technical restrictions, authorization conditions…" /></label>
    <Hosts title="Out of Scope" value={outOfScope} onChange={setOutOfScope} />
    </div></details>
    <details className="ui-disclosure"><summary>Vulnerability policy</summary><div className="mt-4 space-y-5">
    {families("Qualifying vulnerabilities", qualifying, setQualifying)}
    <p className="text-sm text-muted">These fields record program policy for research. They do not select automated tests. Explicit exclusions always take priority.</p>
    {families("Non-qualifying vulnerabilities", nonQualifying, setNonQualifying)}
    </div></details>
    <details className="ui-disclosure"><summary>Advanced</summary><div className="mt-4">
    <label className="block">Required User-Agent *<input required name="requiredUserAgent" maxLength={512} placeholder="BugHunter/1.0" defaultValue={initial?.requiredUserAgent} className={inputClass} /><span className="text-sm text-muted">Used for future scans. Set the value required by the program before running Recon.</span></label>
    </div></details>
    {error && <p role="alert" className="text-danger">{error}</p>}
    {busy&&<p role="status">Saving Target settings…</p>}
    <Button type="submit" disabled={busy}>{busy ? "Saving…" : initial ? "Save Target" : "Create Target"}</Button>
  </form>;
}
