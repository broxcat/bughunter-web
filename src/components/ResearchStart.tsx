"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import CreateResearchButton from "./CreateResearchButton";
type Host = { id: string; host: string; latestRecon: { id: string; createdAt: string } | null };
type Program = { id: string; companyName: string; hosts: Host[] };
export default function ResearchStart() {
  const [programs, setPrograms] = useState<Program[]>([]), [programId, setProgramId] = useState("");
  const [targetId, setTargetId] = useState(""), [error, setError] = useState("");
  useEffect(() => { const controller = new AbortController();
    fetch("/api/scan-hosts", { signal: controller.signal }).then(async r => {
      if (!r.ok) throw new Error("Unable to load targets");
      const list: Program[] = await r.json(); setPrograms(list);
      const query = new URLSearchParams(window.location.search);
      const selected = list.find(p => p.id === query.get("program")) ?? list[0];
      setProgramId(selected?.id ?? ""); setTargetId(selected?.hosts[0]?.id ?? "");
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, []);
  const program = programs.find(p => p.id === programId), host = program?.hosts.find(h => h.id === targetId);
  return <div className="space-y-4">
    <p>Choose an authorized host. Export observed Recon evidence into a persistent Codex workspace.</p>
    <label className="block">Target<select aria-label="Target" className="block w-full rounded border border-border bg-surface p-2" value={programId} onChange={e => { setProgramId(e.target.value); setTargetId(programs.find(p => p.id === e.target.value)?.hosts[0]?.id ?? ""); }}>{programs.map(p => <option key={p.id} value={p.id}>{p.companyName}</option>)}</select></label>
    <label className="block">Host<select aria-label="Host" className="block w-full rounded border border-border bg-surface p-2" value={targetId} onChange={e => setTargetId(e.target.value)}>{program?.hosts.map(h => <option key={h.id} value={h.id}>{h.host}</option>)}</select></label>
    {host && <p>{host.latestRecon ? `Recon source: ${host.latestRecon.id} (${new Date(host.latestRecon.createdAt).toLocaleString()})` : "No completed Recon yet. This workspace will contain scope and metadata only."} <Link className="text-brand" href={`/recon?program=${programId}`}>Run Recon</Link></p>}
    {!host && <p>Add an authorized concrete host in <Link className="text-brand" href="/scopes">Scope</Link>.</p>}
    {error && <p role="alert">{error}</p>}
    <CreateResearchButton key={targetId} targetId={targetId} />
  </div>;
}
