import { foreignOrigin } from '@/lib/requestOrigin';
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadTargetExecution, withTargetExecution } from "@/server/execution";
import { refreshTargetCredential } from "@/server/credentials";
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const target = await prisma.target.findFirst({ where: { id, userId: session.user.id } });
  if (!target) return Response.json({ error: "Not found" }, { status: 404 });
  const parsed = z.object({ credentialId: z.string().min(1), approveTestAccountLogin: z.literal(true) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Explicit test-account login approval is required" }, { status: 400 });
  try {
    const execution = await loadTargetExecution(id);
    const ok = await withTargetExecution(execution, () => refreshTargetCredential(id, parsed.data.credentialId));
    return Response.json({ ok });
  } catch { return Response.json({ error: "Session refresh unavailable for this host" }, { status: 400 }); }
}
