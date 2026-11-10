import { z } from 'zod';
import { auth } from '@/lib/auth';
import { foreignOrigin } from '@/lib/requestOrigin';
import { targetIdentity } from '@/lib/research/identity';
import { dismissAutomationBan } from '@/server/automationDecisions';
import { assetError } from '@/server/scopeAssets';
const input = z.strictObject({ phrase: z.string().min(1).max(64000), expectedPolicyVersion: z.number().int().nonnegative() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (foreignOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const body = input.safeParse(await request.json().catch(() => null));
  if (!body.success || !targetIdentity.safeParse(id).success) return Response.json({ error: 'Invalid automation decision' }, { status: 400 });
  try {
    return Response.json(await dismissAutomationBan(userId, id, body.data.phrase, body.data.expectedPolicyVersion), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return assetError(error); }
}
