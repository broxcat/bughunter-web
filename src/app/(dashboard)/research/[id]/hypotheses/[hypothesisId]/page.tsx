import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { hypothesisDetail, HypothesisSyncError } from "@/server/research/hypotheses";
import { REGISTRY_NOTICE, type ResearchEvidenceReference } from "@/lib/research/hypotheses";
import { researchScopeActive } from "@/server/research/sessions";
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
  const scopeActive = await researchScopeActive(data.session.targetId, session.user.id);
  return <div className="space-y-5"><Link className="text-brand" href={`/research/${id}`}>← Research Session</Link><h1 className="text-2xl font-semibold">{h.externalId} — {h.title}</h1>
    {!scopeActive && <p role="alert">Scope no longer active. Do not continue active testing.</p>}
    <p>{h.status} · Revision {h.revision} · Source: {h.source}</p>
    <p>Imported: {h.importedAt.toISOString()} · Source updated: {h.sourceUpdatedAt?.toISOString() ?? "Not supplied"}</p>
    <p>Confidence: {h.confidence ?? "Not supplied"} (not severity, validation or impact)</p>
    {h.status === "CONFIRMED" && <p className="font-semibold">{REGISTRY_NOTICE}</p>}
    <Card className="p-5"><h2 className="text-xl">WHAT WE THINK</h2><p className="whitespace-pre-wrap">{h.hypothesis}</p></Card>
    <Card className="p-5"><h2 className="text-xl">WHY</h2><p>{Array.isArray(h.evidenceFor) && h.evidenceFor.length ? "Supporting observations are referenced below; review their evidence independently." : "No supporting observations recorded."}</p>{h.notes && <p className="whitespace-pre-wrap">{h.notes}</p>}{h.blockedReason && <p>Blocked: {h.blockedReason}</p>}</Card>
    <Card className="p-5"><h2 className="text-xl">WHAT WOULD DISPROVE IT</h2><p className="whitespace-pre-wrap">{h.falsificationCondition}</p></Card>
    <Card className="p-5"><h2 className="text-xl">WHAT TO TEST NEXT</h2><p className="whitespace-pre-wrap">{h.nextTest}</p><p>Expected signal: {h.expectedSignal}</p></Card>
    <Evidence title="Evidence for" entries={h.evidenceFor} /><Evidence title="Evidence against" entries={h.evidenceAgainst} />
    <p>Tags: {h.tags.join(", ") || "None"}. Workspace: {data.session.workspaceId}. Raw evidence is not imported.</p>
    <section className="space-y-3"><h2 className="text-xl">Revision history</h2>{h.revisions.map(r => <Card key={r.id} className="p-4"><p>Revision {r.revision}{r.revision === h.revision ? " — current" : ""} · {r.createdAt.toISOString()} · {r.source}</p><p>Status: {String((r.snapshot as { status?: string }).status ?? "Unknown")}</p><details><summary>View snapshot</summary><pre className="whitespace-pre-wrap break-words">{JSON.stringify(r.snapshot, null, 2)}</pre></details></Card>)}<div className="flex gap-4">{revisionPage > 1 && <Link className="text-brand" href={`?revisionPage=${revisionPage - 1}`}>Newer revisions</Link>}{revisionPage * data.revisionPageSize < h.revision && <Link className="text-brand" href={`?revisionPage=${revisionPage + 1}`}>Older revisions</Link>}</div></section>
  </div>;
}
