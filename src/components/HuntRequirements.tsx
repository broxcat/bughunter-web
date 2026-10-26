"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReadinessFacts } from "@/lib/hunt/readiness";
import type { HuntPolicy } from "@/lib/hunt/policy";
import type { AuthenticationSummary } from "@/lib/targetAuth";
export default function HuntRequirements({ hosts, onFacts }: { hosts: { id: string; host: string }[]; policy?: HuntPolicy; onFacts?: (facts: ReadinessFacts) => void }) {
  const [hostId, setHostId] = useState(hosts[0]?.id ?? "");
  const [summary, setSummary] = useState<AuthenticationSummary | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!hostId) return;
    const controller = new AbortController();
    const refresh = () => fetch(`/api/targets/${hostId}/hunt-readiness`, { signal: controller.signal }).then(async r => {
      if (!r.ok) throw new Error("Unable to check Hunt readiness");
      const data = await r.json(); setSummary(data.summary); setError(""); onFacts?.(data.facts);
    }).catch(e => { if (e.name !== "AbortError") setError(e.message); });
    void refresh();
    const changed = (event: Event) => { if ((event as CustomEvent).detail === hostId) void refresh(); };
    window.addEventListener("bughunter-authentication-changed", changed);
    return () => { controller.abort(); window.removeEventListener("bughunter-authentication-changed", changed); };
  }, [hostId, onFacts]);
  return <section className="space-y-3" aria-label="Hunt readiness">
    <h2 className="font-semibold">Hunt readiness</h2>
    {hosts.length > 1 && <label>Host<select aria-label="Readiness host" value={hostId} onChange={e => { setHostId(e.target.value); setSummary(null); }} className="ml-2 rounded border border-border bg-surface p-2">{hosts.map(h => <option value={h.id} key={h.id}>{h.host}</option>)}</select></label>}
    {!hosts.length ? <p>Add an in-scope host to start Hunt.</p> : error ? <p role="alert">{error}</p> : !summary ? <p role="status">Checking readiness…</p> : <>
      <ul className="space-y-1 text-sm">
        <li>{summary.scopeValid ? "✓ Scope valid" : "Missing valid scope"}</li>
        <li>{summary.userAgentConfigured ? "✓ User-Agent configured" : "Missing configured User-Agent"}</li>
        {summary.publicReady && <li>✓ Public testing available</li>}
      </ul>
      <p>Public Hunt <strong>{summary.publicReady ? "READY" : "BLOCKED"}</strong></p>
      <p>Authenticated Hunt <strong>{summary.authenticatedReady ? "READY" : "BLOCKED"}</strong></p>
      {summary.authenticatedReady ? <p role="status">✓ Ready for Hunt</p> : summary.publicReady && <div className="space-y-2"><p>Missing authenticated session</p><p className="text-sm">Provide either username/password or a session cookie. Public Hunt remains available.</p><Link className="text-brand" href={`/hosts/${hostId}#authentication`}>Configure authentication →</Link></div>}
    </>}
  </section>;
}
