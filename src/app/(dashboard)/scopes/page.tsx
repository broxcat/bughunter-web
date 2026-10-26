"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ProgramData } from "@/components/ProgramForm";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
export default function ScopesPage() {
  const [programs, setPrograms] = useState<ProgramData[]>([]);
  const [legacy, setLegacy] = useState<{ id: string; host: string; programId: string | null }[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([fetch("/api/programs"), fetch("/api/targets")]).then(async ([p, t]) => {
      if (!p.ok || !t.ok) throw new Error("Unable to load scopes");
      setPrograms(await p.json()); setLegacy((await t.json()).filter((h: { programId: string | null }) => !h.programId));
    }).catch(e => setError(e.message));
  }, []);
  async function adopt(e: React.FormEvent<HTMLFormElement>, host: { id: string; host: string }) {
    e.preventDefault(); const id = new FormData(e.currentTarget).get("program");
    const r = await fetch(`/api/programs/${id}/hosts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ host: host.host, legacyTargetId: host.id }) });
    if (!r.ok) { setError((await r.json()).error); return; }
    window.location.assign(`/scopes/${id}`);
  }
  return <div className="space-y-6"><h1 className="text-2xl font-semibold">Scopes</h1><p className="text-muted">Choose a Target to manage its hosts.</p>{error && <p role="alert">{error}</p>}
    {programs.map(p => <Card className="p-5" key={p.id}><Link className="text-xl text-brand" href={`/scopes/${p.id}`}>{p.companyName}</Link><p>Scope — {p.targets.length} hosts</p></Card>)}
    {!programs.length && <Link className="text-brand" href="/targets">Create a Target →</Link>}
    {legacy.length > 0 && <details><summary>Previous hosts and scan history</summary><p className="py-3 text-sm text-muted">To scan a previous host, explicitly add it to a Target with its required User-Agent. Its history stays attached.</p>{legacy.map(h => <Card className="mb-2 flex flex-wrap gap-3 p-3" key={h.id}><Link href={`/hosts/${h.id}`} className="text-brand">{h.host} — History</Link>{programs.length > 0 && <form className="flex gap-2" onSubmit={e => void adopt(e, h)}><select aria-label={`Target for ${h.host}`} name="program" className="bg-surface">{programs.map(p => <option value={p.id} key={p.id}>{p.companyName}</option>)}</select><Button type="submit" size="sm">Add to Scope</Button></form>}</Card>)}</details>}
  </div>;
}
