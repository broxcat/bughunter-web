import { auth } from '@/lib/auth';
import { foreignOrigin } from '@/lib/requestOrigin';
import { assetInputSchema } from '@/lib/scopeAssets';
import { listScopeAssets, createScopeAsset, assetError } from '@/server/scopeAssets';

type Context = { params: Promise<{ id: string }> };
export async function GET(_req: Request, { params }: Context) {
  const session = await auth(); if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  try { return Response.json(await listScopeAssets(session.user.id, (await params).id), { headers: { 'Cache-Control': 'no-store' } }); } catch (e) { return assetError(e); }
}
export async function POST(req: Request, { params }: Context) {
  const session = await auth(); if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (Number(req.headers.get('content-length')) > 4096) return Response.json({ error: 'Input too large' }, { status: 413 });
  const input = assetInputSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) return Response.json({ error: input.error.issues.map(i => i.message).join('; ') }, { status: 400 });
  try { return Response.json(await createScopeAsset(session.user.id, (await params).id, input.data), { status: 201 }); } catch (e) { return assetError(e); }
}
