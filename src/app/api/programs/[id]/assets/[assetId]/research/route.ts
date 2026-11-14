import { withApiBoundary } from '@/lib/apiBoundary';
import { auth } from '@/lib/auth';
import { foreignOrigin } from '@/lib/requestOrigin';
import { ensureAssetExecution } from '@/server/scopeAssets';
import { assetError } from '@/server/scopeAssets';
 async function handlePOST(req: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const session = await auth(); if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { id, assetId } = await params;
  try { const { target } = await ensureAssetExecution(session.user.id, id, assetId); return Response.json({ targetId: target.id, href: `/research/${target.id}` }); } catch (e) { return assetError(e); }
}

export const POST = withApiBoundary(handlePOST, ["id","assetId"]);
