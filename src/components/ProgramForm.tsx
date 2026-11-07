"use client";
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
const inputClass = "w-full rounded border border-border bg-surface p-2";
function Hosts({ title, value, onChange }: { title: string; value: string[]; onChange: (v: string[]) => void }) {
  return <fieldset id={title==='Out of Scope'?'out-of-scope':undefined} className="space-y-2"><legend className="font-semibold">{title}</legend>
    {value.map((host, i) => <div className="flex gap-2" key={i}><input aria-label={`${title} FQDN ${i + 1}`} required placeholder="api.example.com" className={inputClass} value={host} onChange={e => onChange(value.map((v, n) => n === i ? e.target.value : v))} /><Button variant="ghost" onClick={() => onChange(value.filter((_, n) => n !== i))}>Remove</Button></div>)}
    <Button variant="secondary" onClick={() => onChange([...value, ""])}>+ Add host</Button>
  </fieldset>;
}
export default function ProgramForm({ initial, onSaved }: { initial?: ProgramData; onSaved: (id: string) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scopeHosts, setScopeHosts] = useState<string[]>([]);
  const [outOfScope, setOutOfScope] = useState(initial?.outOfScope ?? []);
  const [scopeRules, setScopeRules] = useState(initial?.scopeRules ?? []);
  const [qualifying, setQualifying] = useState(initial?.qualifying ?? []);
  const [nonQualifying, setNonQualifying] = useState(initial?.nonQualifying ?? []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const body = { ...data, ...(initial?.updatedAt?{expectedUpdatedAt:initial.updatedAt}:{}), platform: data.platform || null, programUrl: data.programUrl || null,
      ...Object.fromEntries(["rewardLow", "rewardMedium", "rewardHigh", "rewardCritical"].map(k => [k, data[k] || null])),
      ...(initial ? {} : { scopeHosts, scopeRules }), outOfScope, qualifying, nonQualifying };
    try {
      const res = await fetch(initial ? `/api/programs/${initial.id}` : "/api/programs", { method: initial ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json(); if (!res.ok) throw new Error(json.error); onSaved(json.id);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const families = (title: string, values: string[], set: (v: string[]) => void) => <fieldset><legend className="mb-2 font-semibold">{title} <span className="font-normal text-muted">(optional)</span></legend><div className="grid gap-2 sm:grid-cols-3">{VULNERABILITY_FAMILIES.map(f => <label key={f} className="text-sm"><input type="checkbox" checked={values.includes(f)} onChange={e => set(e.target.checked ? [...values, f] : values.filter(v => v !== f))} /> {f.replaceAll("_", " ")}</label>)}</div></fieldset>;
  return <form className="space-y-6" onSubmit={submit} aria-busy={busy}>
    <label className="block">Company / Program name *<input autoFocus={!initial} required name="companyName" maxLength={200} defaultValue={initial?.companyName} className={inputClass} /></label>
    <label className="block">Platform<select aria-label="Platform" name="platform" defaultValue={initial?.platform ?? ""} className={inputClass}><option value="">Choose platform</option>{BOUNTY_PLATFORMS.map(p => <option key={p}>{p}</option>)}</select></label>
    <label className="block">Program URL<input name="programUrl" type="url" defaultValue={initial?.programUrl ?? ""} className={inputClass} /></label>
    <fieldset><legend className="font-semibold">Rewards</legend><div className="grid gap-3 sm:grid-cols-5">{(["Low", "Medium", "High", "Critical"] as const).map(level => <label key={level}>{level}<input name={`reward${level}`} inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" defaultValue={initial?.[`reward${level}`] ?? ""} className={inputClass} /></label>)}<label>Currency<input name="rewardCurrency" required pattern="[A-Z]{3}" maxLength={3} defaultValue={initial?.rewardCurrency ?? "EUR"} className={inputClass} /></label></div></fieldset>
    {!initial && <Hosts title="Scope" value={scopeHosts} onChange={setScopeHosts} />}
    {!initial && <Hosts title="Authorized scope rules" value={scopeRules} onChange={setScopeRules} />}
    <p className="text-sm text-muted">Manage structured scope assets, URL/path boundaries, type and value on the Target workspace. Optional initial domain rules are imported as editable assets. Wildcards cover subdomains only; exclusions take priority.</p>
    <label className="block">Rules of engagement<textarea name="rulesOfEngagement" maxLength={20000} rows={5} defaultValue={initial?.rulesOfEngagement ?? ''} className={inputClass} placeholder="Official program rules, technical restrictions, authorization conditions…" /></label>
    <Hosts title="Out of Scope" value={outOfScope} onChange={setOutOfScope} />
    {families("Qualifying vulnerabilities", qualifying, setQualifying)}
    <p className="text-sm text-muted">These fields record program policy for research. They do not select automated tests. Explicit exclusions always take priority.</p>
    {families("Non-qualifying vulnerabilities", nonQualifying, setNonQualifying)}
    <label className="block">Required User-Agent *<input required name="requiredUserAgent" maxLength={512} placeholder="BugHunter/1.0" defaultValue={initial?.requiredUserAgent} className={inputClass} /><span className="text-sm text-muted">Used for every future scan. Enter BugHunter/1.0 explicitly if the program has no special value.</span></label>
    {error && <p role="alert" className="text-danger">{error}</p>}
    {busy&&<p role="status">Saving Target settings…</p>}
    <Button type="submit" disabled={busy}>{busy ? "Saving…" : initial ? "Save Target" : "Create Target"}</Button>
  </form>;
}
