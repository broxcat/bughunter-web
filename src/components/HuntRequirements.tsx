"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EMPTY_READINESS_FACTS, PREREQUISITE_LABELS, resolveHuntReadiness, type ReadinessFacts } from "@/lib/hunt/readiness";
import type { HuntPolicy } from "@/lib/hunt/policy";
export default function HuntRequirements({ hosts, policy, onFacts }: { hosts: { id: string; host: string }[]; policy: HuntPolicy; onFacts?: (facts: ReadinessFacts) => void }) {
  const [hostId, setHostId] = useState(hosts[0]?.id ?? "");
  const [facts, setFacts] = useState(EMPTY_READINESS_FACTS);
  const [credentials, setCredentials] = useState<{ id: string; label: string; hasSession: boolean; hasJwt: boolean }[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!hostId) return;
    const controller = new AbortController();
    fetch(`/api/targets/${hostId}/hunt-readiness`, { signal: controller.signal }).then(async r => {
      if (!r.ok) throw new Error("Unable to assess Hunt requirements"); const data = await r.json();
      setFacts(data.facts); setCredentials(data.credentials); onFacts?.(data.facts);
    }).catch(e => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [hostId, onFacts]);
  const families = resolveHuntReadiness(policy, facts).filter(f => f.selected);
  const missing = families.filter(f => f.prerequisites.some(p => !p.satisfied));
  const blocked = missing.some(f => f.state === "BLOCKED");
  const credentialUrl = `/hosts/${hostId}#credentials`;
  return <section className="space-y-3" aria-label="Hunt readiness">
    <h2 className="font-semibold">Hunt readiness</h2>
    {hosts.length > 0 ? <label>Host<select aria-label="Readiness host" value={hostId} onChange={e => setHostId(e.target.value)} className="ml-2 rounded border border-border bg-surface p-2">{hosts.map(h => <option value={h.id} key={h.id}>{h.host}</option>)}</select></label> : <p>Add a concrete host in Scope to configure sessions and assess authenticated coverage.</p>}
    {error && <p role="alert">{error}</p>}
    <ul className="grid gap-1 text-sm sm:grid-cols-2">{families.map(f => <li key={f.family} className={f.state === "READY" ? "text-green-600" : f.state === "BLOCKED" ? "text-red-600" : "text-amber-600"}>{f.displayName}: {f.state}</li>)}</ul>
    {missing.length > 0 && <div className={`space-y-3 rounded border p-4 ${blocked ? "border-red-500 bg-red-500/10" : "border-amber-500 bg-amber-500/10"}`} role={blocked ? "alert" : "status"}>
      <h3 className="font-semibold">Hunt requirements</h3>
      {missing.map(f => <div key={f.family}><p className={f.state === "BLOCKED" ? "text-red-600" : "text-amber-600"}>⚠ {f.displayName} — {f.state}</p><ul className="ml-5 list-disc text-sm">{f.prerequisites.filter(p => !p.satisfied).map(p => <li key={p.type}>{PREREQUISITE_LABELS[p.type]} ({p.level}) — {p.reason}</li>)}</ul></div>)}
      {hostId && <div className="flex flex-wrap gap-4 text-sm text-brand"><Link href={credentialUrl}>Add credential</Link><Link href={credentialUrl}>Add second account</Link><Link href={credentialUrl}>Configure session</Link><Link href="/settings#hunt-oob">Configure OOB</Link></div>}
    </div>}
    {credentials.map(c => <p className="text-sm text-muted" key={c.id}>Credential configured: {c.label} · {c.hasSession ? "Session material available (not verified)" : "Session unavailable"}{c.hasJwt ? " · JWT available" : ""}</p>)}
    <p className="text-sm text-muted">Readiness does not contact the host. One blocked family does not block other safe tests.</p>
  </section>;
}
