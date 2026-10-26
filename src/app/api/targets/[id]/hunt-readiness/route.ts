import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadHuntReadiness } from "@/server/hunt/readiness";
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const target = await prisma.target.findFirst({ where: { id, userId: session.user.id, program: { ownerId: session.user.id } }, include: { program: true } });
  if (!target?.program) return Response.json({ error: "Host not found" }, { status: 404 });
  return Response.json(await loadHuntReadiness(target.id, target.program));
}
