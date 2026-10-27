import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ownedResearch } from "@/server/research/sessions";
import { readBurpDiagnostic } from "@/server/research/burp";
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const research = await prisma.researchSession.findFirst({ where: { id, ...ownedResearch(session.user.id) }, select: { workspaceId: true } });
  if (!research) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ diagnostic: await readBurpDiagnostic(research.workspaceId) }, { headers: { "Cache-Control": "no-store" } });
}
