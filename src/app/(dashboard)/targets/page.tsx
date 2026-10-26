"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ProgramForm, { type ProgramData } from "@/components/ProgramForm";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
export default function TargetsPage() {
  const router = useRouter();
  const [programs, setPrograms] = useState<ProgramData[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { fetch("/api/programs").then(async r => { if (!r.ok) throw new Error("Unable to load targets"); setPrograms(await r.json()); }).catch(e => setError(e.message)); }, []);
  return <div className="space-y-6"><div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">Targets</h1><Button onClick={() => setCreating(!creating)}>{creating ? "Cancel" : "Create Target"}</Button></div><p className="text-muted">Your companies and bug bounty programs. Manage their hosts in Scope.</p>
    {error && <p role="alert">{error}</p>}
    {creating ? <Card className="p-6"><ProgramForm onSaved={id => router.push(`/targets/${id}`)} /></Card> : programs.map(p => <Card className="p-5" key={p.id}><Link className="text-xl font-semibold text-brand" href={`/targets/${p.id}`}>{p.companyName}</Link><p>{p.platform ?? "Private program"} · Scope — {p.targets.length} hosts</p></Card>)}
    {!creating && !programs.length && !error && <p>Create your first Target to add hosts and start Recon.</p>}
  </div>;
}
