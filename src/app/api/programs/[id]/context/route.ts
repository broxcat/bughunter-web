import { auth } from '@/lib/auth';
import { ensureProgramContext } from '@/server/programContext';
import { ResearchError } from '@/server/research/workspace';
import { foreignOrigin } from '@/lib/requestOrigin';
export async function POST(_req: Request, { params }: { params: Promise<{id:string}> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (foreignOrigin(_req)) return Response.json({error:'Forbidden'},{status:403});
  const { id } = await params;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,149}$/.test(id)) return Response.json({ error: 'Invalid target' }, { status: 400 });
  try { const context = await ensureProgramContext(session.user.id, id); return Response.json({ contextId: context.id }); }
  catch (e) { return Response.json({ error: e instanceof ResearchError ? e.message : 'Context unavailable' }, { status: e instanceof ResearchError ? e.status : 503 }); }
}
