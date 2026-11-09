import { auth } from '@/lib/auth';
import { foreignOrigin } from '@/lib/requestOrigin';
import { advanceCampaign, changeCampaign } from '@/server/campaignOrchestrator';
import { assetError } from '@/server/scopeAssets';
import { settleQueuedCancellations } from '@/server/queue/scanCancellation';
import { z } from 'zod';

const input = z.strictObject({ action: z.enum(['start', 'pause', 'resume', 'handoff']) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (foreignOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const body = input.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: 'Unknown campaign action' }, { status: 400 });
  const { id } = await params;
  try {
    await changeCampaign(userId, id, body.data.action);
    if (body.data.action === 'pause') await settleQueuedCancellations().catch(() => {});
    else if (body.data.action !== 'handoff') await advanceCampaign(userId, id).catch(() => {});
    return Response.json({ accepted: true }, { status: 202, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return assetError(error); }
}
