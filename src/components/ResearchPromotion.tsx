"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "./ui/Button";
export default function ResearchPromotion({ sessionId, hypothesisId, targetId, revision, eligible, existing, requiresReview = false }: { sessionId: string; hypothesisId: string; targetId: string; revision: number; eligible: boolean; requiresReview?: boolean; existing: { findingId: string; hypothesisRevision: number } | null }) {
  const [draft, setDraft] = useState(existing), [acknowledged, setAcknowledged] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = useRef(false);
  async function promote() {
    if (pending.current || !acknowledged) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/research-sessions/${sessionId}/hypotheses/${hypothesisId}/finding-draft`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: revision, acknowledgeHumanReview: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(`${data.code}: ${data.error}`);
      setDraft({ findingId: data.findingId, hypothesisRevision: data.hypothesisRevision });
    } catch (e) { setError((e as Error).message); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className="space-y-3" aria-label="Human review and Finding draft"><h2 className="text-xl">Human review → Finding draft</h2>
    <p>Research CONFIRMED is a claim for review. A draft starts CANDIDATE / UNVALIDATED with INFO severity and is excluded from Reports until Evidence Review confirms it.</p>
    {draft ? <><p>Finding already created from Research revision {draft.hypothesisRevision}. Later Research edits do not overwrite its review.</p><Link className="text-brand" href={`/targets/${targetId}/findings#finding-${draft.findingId}`}>Open Finding draft</Link></> : eligible ? <>
      <label className="block"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} /> I reviewed this revision, its provenance, reproduction and controls. Create only an unvalidated Finding draft.</label>
      <Button disabled={busy || !acknowledged} onClick={promote}>{busy ? "Creating draft…" : "Create Finding Draft"}</Button>
    </> : <p>{requiresReview ? "A supported independent decision on this revision is required before promotion." : "Promotion requires a CONFIRMED v2 hypothesis, current authorization and reproducible controlled evidence."}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
