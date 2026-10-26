import { auth } from "@/lib/auth";
import { z } from "zod";
import { fqdnSchema } from "@/lib/bountyProgram";
import { mutateHost, hostErrorResponse } from "@/server/programHosts";
type Params = { params: Promise<{ id: string; hostId: string }> };
export async function PATCH(req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id, hostId } = await params;
  const parsed = z.object({ host: fqdnSchema }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map(i => i.message).join("; ") }, { status: 400 });
  try { return Response.json(await mutateHost(session.user.id, id, "EDIT", { ...parsed.data, hostId })); }
  catch (e) { return hostErrorResponse(e); }
}
export async function DELETE(_req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id, hostId } = await params;
  try { await mutateHost(session.user.id, id, "REMOVE", { hostId }); return Response.json({ ok: true }); }
  catch (e) { return hostErrorResponse(e); }
}
