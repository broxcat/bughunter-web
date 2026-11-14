import { withApiBoundary } from '@/lib/apiBoundary';
import { assertPublicScopeValues, scopeAdmissionResponse } from '@/server/scopeAdmission';
import { foreignOrigin } from '@/lib/requestOrigin';
import { auth } from "@/lib/auth";
import { z } from "zod";
import { fqdnSchema } from "@/lib/bountyProgram";
import { mutateHost, hostErrorResponse } from "@/server/programHosts";
type Params = { params: Promise<{ id: string; hostId: string }> };
 async function handlePATCH(req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { id, hostId } = await params;
  const parsed = z.object({ host: fqdnSchema }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map(i => i.message).join("; ") }, { status: 400 });
  try { await assertPublicScopeValues([parsed.data.host]); } catch (e) { const refused = scopeAdmissionResponse(e); if (refused) return refused; throw e; }
  try { return Response.json(await mutateHost(session.user.id, id, "EDIT", { ...parsed.data, hostId })); }
  catch (e) { return hostErrorResponse(e); }
}
 async function handleDELETE(_req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (foreignOrigin(_req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { id, hostId } = await params;
  try { await mutateHost(session.user.id, id, "REMOVE", { hostId }); return Response.json({ ok: true }); }
  catch (e) { return hostErrorResponse(e); }
}

export const PATCH = withApiBoundary(handlePATCH, ["id","hostId"]);
export const DELETE = withApiBoundary(handleDELETE, ["id","hostId"]);
