"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
type Program = { id: string; companyName: string; requiredUserAgent: string; hosts: { id: string; host: string }[] };
export default function ScanStart({ type }: { type: "RECON" | "HUNT" }) {
  const router = useRouter();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [company, setCompany] = useState("");
  const [host, setHost] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
      const r = await fetch("/api/scan-runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetId: host, type }) });
      if (!r.ok) throw new Error((await r.json()).error);
      router.push(`/hosts/${host}`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="space-y-6"><h1 className="text-2xl font-semibold">{type === "RECON" ? "Recon" : "Hunt"}</h1><p className="text-muted">Choose a Target and an active in-scope host.</p><Card className="p-6"><form className="space-y-4" onSubmit={start}>
    <label className="block">Company<select className="block w-full rounded border border-border bg-surface p-2" value={company} onChange={e => { setCompany(e.target.value); setHost(programs.find(p => p.id === e.target.value)?.hosts[0]?.id ?? ""); }}>{programs.map(p => <option value={p.id} key={p.id}>{p.companyName}</option>)}</select></label>
    <label className="block">Host<select className="block w-full rounded border border-border bg-surface p-2" value={host} onChange={e => setHost(e.target.value)}>{program?.hosts.map(h => <option value={h.id} key={h.id}>{h.host}</option>)}</select></label>
    {program && <p className="text-sm">Required User-Agent: <code>{program.requiredUserAgent}</code></p>}
    {!host && <p>Add a concrete FQDN to <Link className="text-brand" href={program ? `/scopes/${program.id}` : "/targets"}>Scope</Link> to start scanning.</p>}
    {error && <p role="alert">{error}</p>}<Button type="submit" disabled={!host || busy}>{busy ? "Starting…" : type === "RECON" ? "Start Recon" : "Start Hunt"}</Button>
  </form></Card></div>;
}
