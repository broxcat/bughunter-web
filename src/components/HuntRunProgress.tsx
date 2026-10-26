"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { EVIDENCE_LABELS, huntCounts } from "@/lib/hunt/presentation";
import type { HuntReport } from "@/lib/hunt/report";
import type { HuntPolicySnapshot } from "@/lib/hunt/policy";
import HuntFamilySelection from "./HuntFamilySelection";
import { HUNT_REFERENCES } from "@/lib/hunt/references";
type Run = { id: string; status: string; huntReport: HuntReport | null; huntSnapshot: HuntPolicySnapshot | null; target: { id: string; host: string; program: { companyName: string } | null } };
export default function HuntRunProgress({ id }: { id: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/scan-runs/${encodeURIComponent(id)}/hunt`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(response.status === 404 ? "Hunt not found" : "Unable to load Hunt");
        const next: Run = await response.json(); setRun(next); setError("");
        if (["QUEUED", "RUNNING"].includes(next.status)) timer = setTimeout(poll, 1500);
      } catch (e) { if (!controller.signal.aborted) { setError((e as Error).message); timer = setTimeout(poll, 5000); } }
    }
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [id]);
  const report = run?.huntReport;
  return <div className="space-y-6"><Link href="/hunt" className="text-brand">← Hunt</Link><h1 className="text-2xl font-semibold">HUNT</h1>
    {error && <p role="alert">{error}</p>}
    {!run ? <p>Loading Hunt…</p> : <>
      <Card className="p-5 space-y-2"><h2 className="text-xl">{run.target.program?.companyName ?? "Historical target"}</h2><p>{run.target.host}</p><p role="status">{run.status}</p><Link className="text-brand" href={`/targets/${run.target.id}/findings`}>Open findings</Link></Card>
      {report ? <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Object.entries(huntCounts(report)).map(([label, count]) => <Card key={label} className="p-4"><p>{label}</p><p className="text-2xl font-semibold">{count}</p></Card>)}</div>
        <p>{report.requests} / {report.limits.maxTotalRequests ?? report.limits.totalRequests ?? 100} requests · {report.status}</p>
        {!report.families.length && <p>Preparing shared Recon corpus and checking prerequisites…</p>}
        {report.families.filter(f => f.selected).map(f => <Card className="p-4 space-y-2" key={f.family}><h2 className="font-semibold">{f.displayName}</h2><p className={f.readiness === "BLOCKED" ? "text-red-600" : f.readiness === "DEGRADED" ? "text-amber-600" : "text-green-600"}>{f.readiness} · {f.state}</p><p>{f.completedTechniques} / {f.applicableTechniques} applicable techniques · {f.requests} requests</p><p className="text-sm text-muted">{f.reason}</p>
          {report.candidates.some(c => c.family === f.family && c.evidenceLevel === "CANDIDATE") && <p>Candidates awaiting independent confirmation</p>}
          <details><summary>Advanced techniques</summary><ul className="space-y-2 mt-2">{report.techniques.filter(t => t.family === f.family).map(t => <li key={t.techniqueId}><p>{t.title} · {t.state} · {t.requests} requests</p><p className="text-sm text-muted">{t.reason}</p><ul>{t.referenceIds.map(ref => { const reference = Object.values(HUNT_REFERENCES).flat().find(r => r.id === ref); return reference ? <li key={ref}><a className="text-brand" href={reference.referenceUrl} target="_blank" rel="noreferrer">{reference.referenceTitle}</a></li> : null; })}</ul></li>)}</ul></details>
        </Card>)}
        <section className="space-y-3"><h2 className="text-xl">Evidence</h2><p className="text-sm text-muted">Signals and candidates need validation. Validated behavior is distinct from confirmed vulnerability impact.</p>{report.candidates.map(c => <Card key={c.id} className="p-4"><p className="font-semibold">{EVIDENCE_LABELS[c.evidenceLevel]} · {c.title}</p><p>{c.summary}</p>{c.findingId && <Link className="text-brand" href={`/targets/${run.target.id}/findings`}>Confirmed finding</Link>}<details><summary>Advanced evidence</summary><p>{c.techniqueId}</p><ul>{c.controls.map(control => <li key={control}>{control}</li>)}</ul></details></Card>)}{!report.candidates.length && <p>No evidence recorded.</p>}</section>
      </> : <p>{run.status === "QUEUED" ? "Waiting for the scan worker. Readiness will be checked again before execution." : "No technique report available for this historical run."}</p>}
      {run.huntSnapshot && <HuntFamilySelection families={run.huntSnapshot.families} />}
    </>}
  </div>;
}
