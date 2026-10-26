import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadHuntReadiness } from "@/server/hunt/readiness";
import { readinessSummary } from "@/lib/targetAuth";
import { isExcluded, programSchema } from "@/lib/bountyProgram";
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const target = await prisma.target.findFirst({ where: { id, userId: session.user.id, program: { ownerId: session.user.id } }, include: { program: true, scope: true } });
  if (!target?.program) return Response.json({ error: "Host not found" }, { status: 404 });
  const readiness = await loadHuntReadiness(target.id, target.program);
  const scopeValid = target.active && target.scope.status === "APPROVED" && !target.host.includes("*") && !isExcluded(target.host, target.program.outOfScope);
  const userAgentConfigured = programSchema.shape.requiredUserAgent.safeParse(target.program.requiredUserAgent).success && target.program.requiredUserAgent === target.program.requiredUserAgent.trim();
  return Response.json({ ...readiness, summary: readinessSummary(scopeValid, userAgentConfigured, readiness.facts.authenticatedSession) });
}
