import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ownedResearch, researchSessionSelect } from "@/server/research/sessions";
import ResearchStart from "@/components/ResearchStart";
import { Card } from "@/components/ui/Card";
export default async function ResearchPage() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const sessions = await prisma.researchSession.findMany({ where: ownedResearch(session.user.id), select: researchSessionSelect, orderBy: { createdAt: "desc" }, take: 100 });
  return <div className="space-y-6"><h1 className="text-2xl font-semibold">Codex Research</h1>
    <Card className="p-6"><ResearchStart /></Card>
    <section className="space-y-3"><h2 className="text-xl">Research Sessions</h2>
      {sessions.length === 0 && <p>No research sessions yet.</p>}
      {sessions.map(s => <Card key={s.id} className="p-4"><Link className="text-brand" href={`/research/${s.id}`}>{s.programName} / {s.targetHost}</Link><p>{s.status} · {s.createdAt.toISOString()}</p><p className="font-mono">{s.workspaceId}</p><p>Recon source: {s.reconScanRunId ?? "None"}</p></Card>)}
    </section>
    <Link className="text-brand" href="/hunt">Legacy Hunt history →</Link>
  </div>;
}
