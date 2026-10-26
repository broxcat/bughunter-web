"use client";
import { useState } from "react";
import { findingReviewStatus, type ReviewState } from "@/lib/evidenceReview";
import { Button } from "./ui/Button";
export default function EvidenceReview({ finding, onDone }: { finding: { id: string; evidence?: string | null; impact?: string | null; reviewStatus?: string; reviewEvidence?: { notes?: string } | null; gateStatus?: string }; onDone: () => void }) {
  const status = findingReviewStatus(finding);
  const [notes, setNotes] = useState(finding.reviewEvidence?.notes ?? "");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function decide(next: ReviewState) {
    setBusy(true); setError("");
    try { const r = await fetch(`/api/findings/${finding.id}/validate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next, notes }) }); const data = await r.json(); if (!r.ok) throw new Error(data.error ?? "Unable to save review"); onDone(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="mt-3 space-y-3 border-t border-border pt-3" aria-label="Evidence review">
    <h3 className="font-medium">Evidence review</h3>
    <details><summary>Observed evidence</summary><pre className="mt-2 whitespace-pre-wrap break-all text-xs">{finding.evidence || "No observation recorded"}</pre>{finding.impact && <p>{finding.impact}</p>}</details>
    {status !== "EVIDENCE_REVIEW" ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => void decide("EVIDENCE_REVIEW")}>{status === "CANDIDATE" ? "Review evidence" : "Reopen evidence review"}</Button> : <>
      <p className="text-sm text-muted">Compare the baseline, probe and control. Describe reproduction, impact, authentication context and scope. Keep secrets out of these notes.</p>
      <label className="block text-sm">Reproduction and impact<textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="mt-1 block w-full rounded border border-border bg-surface p-2" /></label>
      <div className="flex flex-wrap gap-2">{(["CONFIRMED", "REJECTED", "INCONCLUSIVE"] as const).map(s => <Button key={s} size="sm" variant={s === "CONFIRMED" ? "primary" : "secondary"} disabled={busy || notes.trim().length < 20} onClick={() => void decide(s)}>{s === "CONFIRMED" ? "Confirm" : s === "REJECTED" ? "Reject" : "Inconclusive"}</Button>)}</div>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
