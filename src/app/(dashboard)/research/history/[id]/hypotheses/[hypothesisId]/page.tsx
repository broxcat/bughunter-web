import EvidencePanel from '@/components/EvidencePanel';
import Link from "next/link";
import ResearchProof from "@/components/ResearchProof";
import ResearchPromotion from "@/components/ResearchPromotion";
import ResearchStagePanel from "@/components/ResearchStagePanel";
import ResearchHumanReview, { ResearchReviewResult } from "@/components/ResearchHumanReview";
import { reproducibleResearchTests, savedResearchReview } from "@/lib/research/humanReview";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { hypothesisDetail, HypothesisSyncError } from "@/server/research/hypotheses";
import { REGISTRY_NOTICE, researchDataSchema, type ResearchEvidenceReference } from "@/lib/research/hypotheses";
import { researchPolicyState } from "@/server/research/sessions";
import { Card } from "@/components/ui/Card";
function Evidence({ title, entries }: { title: string; entries: unknown }) {
  // Render references as escaped text, never as arbitrary links or raw HTML.
  const refs = entries as ResearchEvidenceReference[];
  return <Card className="p-5 space-y-2"><h2 className="text-xl">{title}</h2><ul>{refs.map((e, i) => <li key={i}><code>{e.ref}</code><p className="whitespace-pre-wrap">{e.summary}</p></li>)}</ul>{!refs.length && <p>None recorded.</p>}</Card>;
}
export default async function HypothesisPage({ params, searchParams }: { params: Promise<{ id: string; hypothesisId: string }>; searchParams: Promise<{ revisionPage?: string }> }) {
  const session = await auth(); if (!session?.user?.id) return null;
  const { id, hypothesisId } = await params;
  const query = await searchParams, revisionPage = Number(query.revisionPage ?? "1");
  if (!Number.isSafeInteger(revisionPage) || revisionPage < 1 || revisionPage > 9999) notFound();
  let data;
  try { data = await hypothesisDetail(id, hypothesisId, session.user.id, revisionPage); }
  catch (error) { if (error instanceof HypothesisSyncError && error.status === 404) notFound(); throw error; }
  const h = data.hypothesis;
  const policyState = await researchPolicyState(data.session.targetId, session.user.id, data.session.authorizationSnapshot);
  const scopeActive = policyState !== "INACTIVE";
  const proof = researchDataSchema.safeParse(h.researchData);
  const review = savedResearchReview.safeParse(data.humanReview).data ?? null;
  const requiresReview = Boolean(data.session.activeTargetId);
  const reviewable = policyState === "CURRENT" && data.session.status === "READY" && proof.success;
  const testIds = h.status === "CONFIRMED" && proof.success ? reproducibleResearchTests(proof.data).map(test => test.id) : [];
  const reviewInput = requiresReview && reviewable && proof.data.tests.length
    ? { sessionId: id, hypothesisId: h.id, revision: h.revision }
    : null;
  return <div className="space-y-5"><Link className="text-brand" href={`/research/history/${id}`}>← Research Session</Link><h1 className="text-2xl font-semibold">{h.externalId} — {h.title}</h1>
    {!scopeActive && <p role="alert">Scope no longer active. Do not continue active testing.</p>}
    {policyState === "CHANGED" && <p role="alert">Program or scope changed since export. Create a current workspace before promotion.</p>}
    <p>{h.status} · Revision {h.revision} · Source: {h.source}</p>
    <p>Imported: {h.importedAt.toISOString()} · Source updated: {h.sourceUpdatedAt?.toISOString() ?? "Not supplied"}</p>
    <p>Confidence: {h.confidence ?? "Not supplied"} (not severity, validation or impact)</p>
    {h.status === "CONFIRMED" && <p className="font-semibold">{REGISTRY_NOTICE}</p>}
    <Card className="p-5"><h2 className="text-xl">What we think</h2><p className="whitespace-pre-wrap">{h.hypothesis}</p></Card>
    <Card className="p-5"><h2 className="text-xl">WHY</h2><p>{Array.isArray(h.evidenceFor) && h.evidenceFor.length ? "Supporting observations are referenced below; review their evidence independently." : "No supporting observations recorded."}</p>{h.notes && <p className="whitespace-pre-wrap">{h.notes}</p>}{h.blockedReason && <p>Blocked: {h.blockedReason}</p>}</Card>
    <Card className="p-5"><h2 className="text-xl">What would disprove it</h2><p className="whitespace-pre-wrap">{h.falsificationCondition}</p></Card>
    <Card className="p-5"><h2 className="text-xl">What to test next</h2><p className="whitespace-pre-wrap">{h.nextTest}</p><p>Expected signal: {h.expectedSignal}</p></Card>
    <Card className="p-5"><ResearchProof value={h.researchData} /></Card>
    {reviewInput && <section aria-label="Independent research review" className="space-y-2">
      <ResearchStagePanel key={h.revision + ":validate"} title="Challenge the hypothesis" targetId={data.session.targetId} input={{ ...reviewInput, stage: "validate" }} />
      <ResearchStagePanel key={h.revision + ":trace"} title="Trace the demonstrated impact" targetId={data.session.targetId} input={{ ...reviewInput, stage: "trace" }} />
    </section>}
    <EvidencePanel targetId={data.session.targetId} sessionId={id} link={{entity:'hypothesis',id:h.id,role:'SUPPORTS'}}/>
    {requiresReview && (review || !h.promotion) && <ResearchHumanReview key={h.revision} sessionId={id} hypothesisId={h.id} revision={h.revision} review={review} canReview={reviewable} testIds={testIds}/>}
    <ResearchPromotion key={h.revision} sessionId={id} hypothesisId={h.id} targetId={data.session.targetId} revision={h.revision} eligible={h.status === "CONFIRMED" && reviewable && (!requiresReview || review?.verdict === "SUPPORTED")} existing={h.promotion} requiresReview={requiresReview && review?.verdict !== "SUPPORTED"}/>
    <Evidence title="Evidence for" entries={h.evidenceFor} /><Evidence title="Evidence against" entries={h.evidenceAgainst} />
    <p>Tags: {h.tags.join(", ") || "None"}. Raw evidence is not imported.</p>
    <section className="space-y-3"><h2 className="text-xl">Revision history</h2>{h.revisions.map(r => { const decision = savedResearchReview.safeParse(r.humanReview).data; return <Card key={r.id} className="p-4"><p>Revision {r.revision}{r.revision === h.revision ? " — current" : ""} · {r.createdAt.toISOString()} · {r.source}</p><p>Status: {String((r.snapshot as { status?: string }).status ?? "Unknown")}</p><details><summary>View snapshot</summary><pre className="whitespace-pre-wrap break-words">{JSON.stringify(r.snapshot, null, 2)}</pre></details>{decision && <ResearchReviewResult review={decision}/>}</Card>; })}<div className="flex gap-4">{data.revisionPage > 1 && <Link className="text-brand" href={`?revisionPage=${data.revisionPage - 1}`}>Newer revisions</Link>}{data.revisionPage < data.revisionPages && <Link className="text-brand" href={`?revisionPage=${data.revisionPage + 1}`}>Older revisions</Link>}</div></section>
  </div>;
}
