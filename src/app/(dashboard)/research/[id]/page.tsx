import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ownedResearch, researchSessionSelect, researchScopeActive } from "@/server/research/sessions";
import ResearchHypotheses, { type HypothesisListData } from "@/components/ResearchHypotheses";
import { listHypotheses } from "@/server/research/hypotheses";
import { Card } from "@/components/ui/Card";
export default async function ResearchSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const { id } = await params;
  const research = await prisma.researchSession.findFirst({ where: { id, ...ownedResearch(session.user.id) }, select: researchSessionSelect });
  if (!research) notFound();
  const scopeActive = await researchScopeActive(research.targetId, session.user.id);
  const hypotheses = await listHypotheses(id, session.user.id);
  const port = /^\d{1,5}$/.test(process.env.RESEARCH_SSH_PORT ?? "") ? process.env.RESEARCH_SSH_PORT : "2222";
  return <div className="space-y-6"><Link className="text-brand" href="/research">← Research</Link><h1 className="text-2xl font-semibold">{research.programName} / {research.targetHost}</h1>
    {!scopeActive && <p role="alert">Scope no longer active. Do not continue active testing. Historical hypothesis synchronization remains available.</p>}
    <Card className="p-5 space-y-2"><p>Status: {research.status}</p><p>Created: {research.createdAt.toISOString()}</p><p>Workspace ID: <code>{research.workspaceId}</code></p><p>Recon source: {research.reconScanRunId ?? "None"}</p></Card>
    {research.status === "READY" && <Card className="p-5 space-y-3"><h2 className="text-xl">Open workspace</h2><p>Connect from the Docker host using your registered public key:</p><pre className="overflow-auto">{`ssh -i ~/.ssh/bughunter_research -p ${port} researcher@127.0.0.1\ncd /workspaces/${research.workspaceId}\nbughunter-validate-hypotheses\nbughunter-codex`}</pre><p>Read AGENTS.md and scope.md before doing anything. Check that authorization is still active.</p><p className="text-sm text-muted">Codex uses --yolo inside the isolated runner. Sign in there with codex login --device-auth if needed. Target credentials are not exported.</p><a className="text-brand" href={`/api/research-sessions/${research.id}/zip`}>Download workspace ZIP</a><p className="text-sm text-muted">The ZIP contains the initial export; subsequent research edits stay in the runner.</p></Card>}
    <ResearchHypotheses sessionId={id} initial={JSON.parse(JSON.stringify(hypotheses)) as HypothesisListData} />
    <Card className="p-5"><h2 className="text-xl">Authorized scope snapshot</h2><pre className="whitespace-pre-wrap">{research.scopeMarkdown || "No export was published."}</pre></Card>
    <Card className="p-5"><h2 className="text-xl">Exported files</h2><ul>{research.files.map(file => <li key={file}><code>{file}</code></li>)}</ul></Card>
  </div>;
}
