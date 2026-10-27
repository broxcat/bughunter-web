"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { HYPOTHESIS_STATUSES, REGISTRY_NOTICE, type HypothesisStatus } from "@/lib/research/hypotheses";

type Hypothesis = { id: string; externalId: string; title: string; status: HypothesisStatus; hypothesis: string; evidenceFor: unknown[]; evidenceAgainst: unknown[]; nextTest: string; expectedSignal: string; falsificationCondition: string; blockedReason: string | null; notes: string | null };
export type HypothesisListData = { session: { status: string; hypothesesSyncedAt: string | null }; counts: Record<string, number>; total: number; page: number; pageSize: number; hypotheses: Hypothesis[] };
export default function ResearchHypotheses({ sessionId, initial }: { sessionId: string; initial: HypothesisListData }) {
  const [data, setData] = useState(initial), [status, setStatus] = useState<HypothesisStatus | "">("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [result, setResult] = useState("");
  async function load(filter: HypothesisStatus | "", page = 1) {
    const r = await fetch(`/api/research-sessions/${sessionId}/hypotheses?${new URLSearchParams({ ...(filter ? { status: filter } : {}), page: String(page) })}`, { cache: "no-store" });
    if (!r.ok) throw new Error("Unable to load hypotheses");
    setData(await r.json()); setStatus(filter);
  }
  async function filter(next: HypothesisStatus | "", page = 1) {
    setBusy(true); setError("");
    try { await load(next, page); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function sync() {
    if (busy) return;
    setBusy(true); setError(""); setResult("");
    try {
      const response = await fetch(`/api/research-sessions/${sessionId}/hypotheses/sync`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(`${body.code ?? "SYNC_FAILED"}: ${body.error}. ${(body.issues ?? []).map((issue: { path: string; message: string }) => `${issue.path}: ${issue.message}`).join("; ")}`);
      await load(status);
      setResult(`Synced: ${body.created} created, ${body.updated} updated, ${body.unchanged} unchanged.`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="space-y-4" aria-label="Hypotheses">
    <h2 className="text-xl">Hypotheses</h2>
    <p>Workspace → BugHunter, read-only registry. A CONFIRMED hypothesis is a research claim requiring human evidence review before any Finding.</p>
    <p>Last synced: {data.session.hypothesesSyncedAt ? new Date(data.session.hypothesesSyncedAt).toLocaleString() : "Never"}</p>
    <Button onClick={sync} disabled={busy || data.session.status !== "READY"}>{busy ? "Working…" : "Sync from workspace"}</Button>
    {data.session.status === "ARCHIVED" && <p>Archived session — sync disabled.</p>}
    <p className="text-sm text-muted">Validate inside the workspace with <code>bughunter-validate-hypotheses</code> before syncing. No automatic synchronization.</p>
    {error && <div role="alert"><p>Hypotheses sync failed</p><p className="whitespace-pre-wrap">{error}</p><p>Run <code>bughunter-validate-hypotheses</code> inside the research workspace.</p></div>}
    {result && <p role="status">{result}</p>}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{HYPOTHESIS_STATUSES.map(s => <Card key={s} className="p-3"><p>{s}</p><p aria-label={`${s} hypotheses`} className="text-2xl">{data.counts[s] ?? 0}</p></Card>)}</div>
    <div className="flex flex-wrap gap-2" aria-label="Filter hypotheses">{(["", ...HYPOTHESIS_STATUSES] as const).map(s => <Button key={s} variant="secondary" disabled={busy} aria-pressed={status === s} onClick={() => void filter(s)}>{s ? s[0] + s.slice(1).toLowerCase() : "All"}</Button>)}</div>
    {data.hypotheses.map(h => <Card key={h.id} className="p-5 space-y-2">
      <p>{h.externalId} · {h.status}</p><h3 className="text-lg font-semibold">{h.title}</h3>
      {h.status === "CONFIRMED" && <p className="font-semibold">{REGISTRY_NOTICE}</p>}
      <p><strong>Hypothesis:</strong> {h.hypothesis}</p><p>Evidence for: {h.evidenceFor.length} · Evidence against: {h.evidenceAgainst.length}</p>
      {h.status === "BLOCKED" && <p>Blocked: {h.blockedReason}</p>}
      {h.status === "REJECTED" && h.notes && <p>Why rejected: {h.notes}</p>}
      <p><strong>Next distinct test:</strong> {h.nextTest}</p><p><strong>Expected signal:</strong> {h.expectedSignal}</p><p><strong>Falsification condition:</strong> {h.falsificationCondition}</p>
      <Link href={`/research/${sessionId}/hypotheses/${h.id}`} className="text-brand">View details — {h.externalId}</Link>
    </Card>)}
    {!data.hypotheses.length && <p>No hypotheses in this view. Keep negative and rejected results in the registry.</p>}
    {data.total > data.pageSize && <div className="flex gap-3"><Button disabled={busy || data.page === 1} onClick={() => void filter(status, data.page - 1)}>Previous</Button><p>Page {data.page} / {Math.ceil(data.total / data.pageSize)}</p><Button disabled={busy || data.page * data.pageSize >= data.total} onClick={() => void filter(status, data.page + 1)}>Next</Button></div>}
  </section>;
}
