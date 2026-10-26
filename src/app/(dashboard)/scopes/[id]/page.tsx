"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import type { ProgramData } from "@/components/ProgramForm";
import { isExcluded } from "@/lib/bountyProgram";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
type Host = { id: string; host: string; active: boolean };
export default function ScopePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [program, setProgram] = useState<ProgramData | null>(null);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [out, setOut] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    const [p, h] = await Promise.all([fetch(`/api/programs/${id}`), fetch(`/api/programs/${id}/hosts`)]);
    if (!p.ok || !h.ok) throw new Error("Target not found");
    setProgram(await p.json()); setHosts(await h.json());
  }
  useEffect(() => { Promise.all([fetch(`/api/programs/${id}`), fetch(`/api/programs/${id}/hosts`)]).then(async ([p, h]) => { if (!p.ok || !h.ok) throw new Error("Target not found"); setProgram(await p.json()); setHosts(await h.json()); }).catch(e => setError(e.message)); }, [id]);
  async function save(host?: Host) {
    if (!program) return; setBusy(true); setError("");
    try {
      let url = `/api/programs/${id}/hosts${host ? `/${host.id}` : ""}`;
      let method = host ? "PATCH" : "POST";
      let body: object = { host: value };
      if (out) {
        url = `/api/programs/${id}`; method = "PATCH";
        body = { outOfScope: editing !== null ? program.outOfScope.map((h, n) => String(n) === editing ? value : h) : [...program.outOfScope, value] };
      }
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json()).error);
      setEditing(null); setValue(""); setAdding(false); await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function remove(host: Host | string) {
    if (!program) return; setBusy(true); setError("");
    try {
      const r = typeof host === "string" ? await fetch(`/api/programs/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outOfScope: program.outOfScope.filter(h => h !== host) }) }) : await fetch(`/api/programs/${id}/hosts/${host.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json()).error); await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!program) return <p role="status">{error || "Loading…"}</p>;
  const active = hosts.filter(h => h.active);
  const form = (host?: Host) => <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void save(host); }}><input autoFocus aria-label="FQDN" placeholder="api.example.com" required className="min-w-0 flex-1 rounded border border-border bg-surface p-2" value={value} onChange={e => setValue(e.target.value)} /><Button type="submit" disabled={busy}>Save</Button><Button variant="ghost" onClick={() => { setEditing(null); setAdding(false); }}>Cancel</Button></form>;
  return <div className="space-y-6"><Link href="/scopes" className="text-brand">← Scopes</Link><h1 className="text-2xl font-semibold">{program.companyName}</h1><Link href={`/targets/${id}`} className="text-brand">Target information →</Link>
    <div className="flex gap-3"><Button variant={!out ? "primary" : "secondary"} onClick={() => { setOut(false); setEditing(null); setAdding(false); }}>Scope — {active.length} hosts</Button><Button variant={out ? "primary" : "secondary"} onClick={() => { setOut(true); setEditing(null); setAdding(false); }}>Out of scope — {program.outOfScope.length} hosts</Button></div>
    <p className="text-muted">{out ? "These hosts are excluded, including when covered by a wildcard in Scope." : "Every listed host is active. Wildcards are scope rules; add a concrete FQDN before scanning it."}</p>
    {error && <p role="alert">{error}</p>}
    {(out ? program.outOfScope.map((host, i) => <Card key={host} className="space-y-2 p-4">{editing === String(i) ? form() : <div className="flex flex-wrap items-center gap-3"><code>{host}</code><Button variant="ghost" onClick={() => { setEditing(String(i)); setValue(host); setAdding(false); }}>Edit</Button><Button variant="ghost" disabled={busy} onClick={() => void remove(host)}>Remove</Button></div>}</Card>) : active.map(h => <Card key={h.id} className="space-y-2 p-4">{editing === h.id ? form(h) : <div className="flex flex-wrap items-center gap-3"><span>✓ <code>{h.host}</code></span>{isExcluded(h.host, program.outOfScope) && <span className="text-sm text-muted">Excluded from scans</span>}<Link className="text-brand" href={`/hosts/${h.id}`}>Open host</Link><Button variant="ghost" onClick={() => { setEditing(h.id); setValue(h.host); setAdding(false); }}>Edit</Button><Button variant="ghost" disabled={busy} onClick={() => void remove(h)}>Remove from scope</Button></div>}</Card>))}
    {adding ? form() : <Button onClick={() => { setAdding(true); setEditing(null); setValue(""); }}>+ Add host</Button>}
    {!out && hosts.some(h => !h.active) && <details><summary>Previous hosts and scan history</summary>{hosts.filter(h => !h.active).map(h => <p key={h.id}><Link className="text-brand" href={`/hosts/${h.id}`}>{h.host} — History</Link></p>)}</details>}
  </div>;
}
