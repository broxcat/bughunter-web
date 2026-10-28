import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { scanRejection } from "@/server/execution";
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const programs = await prisma.bountyProgram.findMany({ where: { ownerId: session.user.id }, orderBy: { companyName: "asc" },
    include: { targets: { where: { userId: session.user.id, active: true }, orderBy: { host: "asc" }, include: { scope: true, scanRuns: { where: { type: "RECON", status: "COMPLETED" }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, createdAt: true } } } } } });
  return Response.json(programs.map(p => ({ id: p.id, companyName: p.companyName, requiredUserAgent: p.requiredUserAgent, qualifying: p.qualifying, nonQualifying: p.nonQualifying, scopeRules: p.scopeRules, deletingAt: p.deletingAt,
    hosts: p.targets.filter(t => !scanRejection({ ...t, program: p }, 'RECON')).map(t => ({ id: t.id, host: t.host, latestRecon: t.scanRuns[0] ?? null })) })));
}
