import { auth } from '@/lib/auth';
import { foreignOrigin } from '@/lib/requestOrigin';
import { assetEditSchema } from '@/lib/scopeAssets';
import { editScopeAsset } from '@/server/scopeAssets';
import { assetError } from '@/server/scopeAssets';
type Context = { params: Promise<{ id: string; assetId: string }> };
async function mutate(req: Request, { params }: Context, remove: boolean) {
  const session = await auth(); if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const input = remove ? null : assetEditSchema.safeParse(await req.json().catch(() => null));
  if (input && !input.success) return Response.json({ error: 'Invalid type or asset value' }, { status: 400 });
  const { id, assetId } = await params;
  try { return Response.json(await editScopeAsset(session.user.id, id, assetId, input?.success ? input.data : null)); } catch (e) { return assetError(e); }
}
export const PATCH = (req: Request, context: Context) => mutate(req, context, false);
export const DELETE = (req: Request, context: Context) => mutate(req, context, true);
