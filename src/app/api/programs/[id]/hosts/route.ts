import { foreignOrigin } from '@/lib/requestOrigin';
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { fqdnSchema } from "@/lib/bountyProgram";
import { mutateHost, hostErrorResponse } from "@/server/programHosts";
type Params = { params: Promise<{ id: string }> };
export async function GET(_req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!await prisma.bountyProgram.findFirst({ where: { id, ownerId: session.user.id } })) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(await prisma.target.findMany({ where: { programId: id, userId: session.user.id, contextOnly: false }, orderBy: [{host:'asc'},{id:'asc'}], select: { id: true, host: true, active: true } }));
}
export async function POST(req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const parsed = z.object({ host: fqdnSchema, legacyTargetId: z.string().optional() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map(i => i.message).join("; ") }, { status: 400 });
  try { return Response.json(await mutateHost(session.user.id, id, "ADD", parsed.data), { status: 201 }); }
  catch (e) { return hostErrorResponse(e); }
}
