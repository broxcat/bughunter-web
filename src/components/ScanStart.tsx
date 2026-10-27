"use client";
import Link from "next/link";
import HuntRequirements from "@/components/HuntRequirements";
import HuntFamilySelection from "@/components/HuntFamilySelection";
import { resolveHuntFamilies } from "@/lib/hunt/policy";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
type Program = { qualifying: string[]; nonQualifying: string[]; id: string; companyName: string; requiredUserAgent: string; hosts: { id: string; host: string }[] };
export default function ScanStart({ type }: { type: "RECON" | "HUNT" }) {
  const router = useRouter();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [company, setCompany] = useState("");
  const [host, setHost] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pendingRequest = useRef<{ body: string; key: string } | null>(null);
  const [timing, setTiming] = useState<string[]>([]);
  useEffect(() => { fetch("/api/scan-hosts").then(async r => {
    if (!r.ok) throw new Error("Unable to load active scope hosts"); const p: Program[] = await r.json(); setPrograms(p);
    const requested = new URLSearchParams(window.location.search).get("program");
    const selected = p.find(v => v.id === requested) ?? p[0];
    setCompany(selected?.id ?? ""); setHost(selected?.hosts[0]?.id ?? "");
  }).catch(e => setError(e.message)); }, []);
  const program = programs.find(p => p.id === company);
  async function start(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const body = JSON.stringify({ targetId: host, type, approvedTechniques: timing.flatMap(f => [`${f}.timing-screen`, `${f}.timing-confirm`]), ...(timing.length ? { approveBoundedTiming: true } : {}) });
      if (pendingRequest.current?.body !== body) pendingRequest.current = { body, key: crypto.randomUUID() };
      const r = await fetch("/api/scan-runs", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": pendingRequest.current.key }, body });
      if (!r.ok) throw new Error((await r.json()).error);
      const run = await r.json();
      pendingRequest.current = null;
      router.push(type === "HUNT" ? `/hunt/${run.id}` : `/hosts/${host}`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="space-y-6"><h1 className="text-2xl font-semibold">{type === "RECON" ? "Recon" : "Hunt"}</h1><p className="text-muted">Choose a Target and an active in-scope host.</p><Card className="p-6"><form className="space-y-4" onSubmit={start}>
    <label className="block">Company<select aria-label="Company" className="block w-full rounded border border-border bg-surface p-2" value={company} onChange={e => { setTiming([]); setCompany(e.target.value); setHost(programs.find(p => p.id === e.target.value)?.hosts[0]?.id ?? ""); }}>{programs.map(p => <option value={p.id} key={p.id}>{p.companyName}</option>)}</select></label>
    <label className="block">Host<select aria-label="Host" className="block w-full rounded border border-border bg-surface p-2" value={host} onChange={e => { setTiming([]); setHost(e.target.value); }}>{program?.hosts.map(h => <option value={h.id} key={h.id}>{h.host}</option>)}</select></label>
    {program && <p className="text-sm">Required User-Agent: <code>{program.requiredUserAgent}</code></p>}
    {type === "HUNT" && program && <details><summary>Advanced — Hunt coverage</summary><HuntFamilySelection families={resolveHuntFamilies(program)} /></details>}
    {type === "HUNT" && program && host && <HuntRequirements key={host} hosts={program.hosts.filter(h => h.id === host)} policy={program} />}
    {type === "HUNT" && program && <details><summary>Optional bounded timing tests — explicit approval</summary><p className="text-sm text-muted">Disabled by default. Each selected family uses fixed 1 and 2 second delays, at most 12 requests and 9 seconds of induced waiting, sequentially. Approve only for an authorized test environment.</p>{resolveHuntFamilies(program).filter(f => f.selected && ["sqli", "command-injection"].includes(f.family)).map(f => { const key = f.family === "sqli" ? "sqli" : "cmdi"; return <label className="block" key={key}><input type="checkbox" checked={timing.includes(key)} onChange={e => setTiming(old => e.target.checked ? [...old, key] : old.filter(v => v !== key))} /> I explicitly approve bounded {f.displayName} timing tests for this Hunt</label>; })}</details>}
    {!host && <p>Add a concrete FQDN to <Link className="text-brand" href={program ? `/scopes/${program.id}` : "/targets"}>Scope</Link> to start scanning.</p>}
    {error && <p role="alert">{error}</p>}<Button type="submit" disabled={!host || busy}>{busy ? "Starting…" : type === "RECON" ? "Start Recon" : "Start Hunt"}</Button>
  </form></Card></div>;
}
