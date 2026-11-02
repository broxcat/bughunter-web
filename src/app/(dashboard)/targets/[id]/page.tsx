"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import ProgramWorkflow from "@/components/ProgramWorkflow";
import ProgramForm, { type ProgramData } from "@/components/ProgramForm";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
export default function ProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [program, setProgram] = useState<ProgramData | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  async function load() { try { const r = await fetch(`/api/programs/${id}`); if (!r.ok) throw new Error("Target not found"); setProgram(await r.json()); } catch (e) { setError((e as Error).message); } }
  useEffect(() => { fetch(`/api/programs/${id}`).then(async r => {
    if (r.status === 404) {
      const legacy = await fetch(`/api/targets/${id}`);
      if (legacy.ok) { router.replace(`/hosts/${id}`); return; }
    }
    if (!r.ok) throw new Error("Target not found"); setProgram(await r.json());
  }).catch(e => setError(e.message)); }, [id, router]);
  if (!program) return <p role="status">{error || "Loading…"}</p>;
  return <div className="space-y-6"><Link href="/targets" className="text-brand">← Targets</Link><h1 className="text-2xl font-semibold">{program.companyName}</h1>
    <Button variant="secondary" onClick={() => setEditing(!editing)}>{editing ? "Cancel" : "Edit Target"}</Button>
    <ProgramWorkflow program={program} />
    {editing ? <Card className="p-6"><ProgramForm initial={program} onSaved={() => { setEditing(false); void load(); }} /></Card> : <>
      <details><summary className="cursor-pointer text-brand">Program details and rules</summary><Card className="mt-3 space-y-4 p-6"><p>Platform: {program.platform ?? "—"}</p>{program.programUrl && <a href={program.programUrl} rel="noreferrer" target="_blank" className="text-brand">Program information ↗</a>}
        <dl className="grid grid-cols-2 gap-2">{(["Low", "Medium", "High", "Critical"] as const).map(l => <div key={l}><dt>{l}</dt><dd>{program[`reward${l}`] ?? "—"} {program.rewardCurrency}</dd></div>)}</dl>
        <p>Required User-Agent: <code>{program.requiredUserAgent}</code></p><p>Scope — {program.targets.length} hosts</p><p>Out of Scope — {program.outOfScope.length} hosts</p>
        <p>Qualifying: {program.qualifying.join(", ") || "Not specified"}</p><p>Non-qualifying: {program.nonQualifying.join(", ") || "None"}</p>
      </Card></details>
    </>}
  </div>;
}
