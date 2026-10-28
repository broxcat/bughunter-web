"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
type Program = { id: string; companyName: string; requiredUserAgent: string; scopeRules: string[]; deletingAt: string|null; hosts: { id: string; host: string }[] };
export default function ScanStart() {
  const router = useRouter();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [company, setCompany] = useState("");
  const [host, setHost] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pendingRequest = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => { fetch("/api/scan-hosts").then(async r => {
    if (!r.ok) throw new Error("Unable to load active scope hosts"); const p: Program[] = await r.json(); setPrograms(p);
    const requested = new URLSearchParams(window.location.search).get("program");
    const selected = p.find(v => v.id === requested) ?? p[0];
    setCompany(selected?.id ?? ""); setHost(selected?.scopeRules.length ? "" : selected?.hosts[0]?.id ?? "");
  }).catch(e => setError(e.message)); }, []);
  const program = programs.find(p => p.id === company);
  async function start(e: React.FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      const body = JSON.stringify({ targetId: host || company, type: "RECON" });
      if (pendingRequest.current?.body !== body) pendingRequest.current = { body, key: crypto.randomUUID() };
      const r = await fetch(host ? "/api/scan-runs" : `/api/programs/${company}/recon`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": pendingRequest.current.key }, body });
      if (!r.ok) throw new Error((await r.json()).error);
      pendingRequest.current = null;
      router.push(host ? `/hosts/${host}` : `/targets/${company}?tab=RECON`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="space-y-6"><h1 className="text-2xl font-semibold">Recon</h1><p className="text-muted">Choose program scope for passive discovery, including wildcard-only scopes, or select an authorized concrete host for the existing host pipeline.</p><Card className="p-6"><form className="space-y-4" onSubmit={start}>
    <label className="block">Company<select aria-label="Company" className="block w-full rounded border border-border bg-surface p-2" value={company} onChange={e => { setCompany(e.target.value); const next=programs.find(p => p.id === e.target.value); setHost(next?.scopeRules.length ? "" : next?.hosts[0]?.id ?? ""); }}>{programs.map(p => <option value={p.id} key={p.id}>{p.companyName}</option>)}</select></label>
    <label className="block">Host<select aria-label="Host" className="block w-full rounded border border-border bg-surface p-2" value={host} onChange={e => setHost(e.target.value)}>{!!program?.scopeRules.length && <option value="">Program scope — passive discovery</option>}{program?.hosts.map(h => <option value={h.id} key={h.id}>{h.host}</option>)}</select></label>
    {program && <p className="text-sm">Required User-Agent: <code>{program.requiredUserAgent}</code></p>}
    {!host && !program?.scopeRules.length && <p>Define authorized rules in <Link className="text-brand" href={program ? `/scopes/${program.id}` : "/targets"}>Scope</Link> to start Recon. Wildcards are supported.</p>}
    {error && <p role="alert">{error}</p>}<Button type="submit" disabled={(!host && !program?.scopeRules.length) || !!program?.deletingAt || busy}>{busy ? "Starting…" : "Start Recon"}</Button>
  </form></Card></div>;
}
