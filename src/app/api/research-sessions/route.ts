import { foreignOrigin } from '@/lib/requestOrigin';
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { createResearchSession, ownedResearch, researchSessionSelect } from "@/server/research/sessions";
import { ResearchError } from "@/server/research/workspace";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const sessions = await prisma.researchSession.findMany({ where: ownedResearch(session.user.id), select: researchSessionSelect, orderBy: { createdAt: "desc" }, take: 100 });
  return Response.json(sessions, { headers: { "Cache-Control": "no-store" } });
}
const input = z.object({ targetId: z.string().min(1).max(200) }).strict();
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Provide only a targetId" }, { status: 400 });
  try {
    // Archival compatibility export only. Active consoles use the per-Target ticket API.
    return Response.json(await createResearchSession(session.user.id, parsed.data.targetId), { status: 201, headers: { "Cache-Control": "no-store", "Deprecation": "true" } });
  } catch (error) {
    const known = error instanceof ResearchError;
    const status = known ? error.status : 500;
    return Response.json({ error: known ? error.message : "Unable to create research workspace" }, { status, headers: status === 429 ? { "Retry-After": "3600" } : {} });
  }
}
