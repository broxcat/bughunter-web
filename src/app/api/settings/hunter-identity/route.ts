
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { foreignOrigin } from '@/lib/requestOrigin';
import { hunterIdentitySchema } from '@/lib/programExecutionPolicy';

export async function GET() {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const identity = await prisma.hunterIdentity.findUnique({ where: { userId }, select: { userAgent: true, headers: true } });
  return Response.json(identity ?? { userAgent: null, headers: [] }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function PUT(request: Request) {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (foreignOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const parsed = hunterIdentitySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Enter a valid User-Agent and distinct identification headers.' }, { status: 400 });
  const { userAgent, headers } = parsed.data;
  await prisma.hunterIdentity.upsert({ where: { userId }, create: { userId, userAgent, headers }, update: { userAgent, headers } });
  return Response.json({ userAgent, headers }, { headers: { 'Cache-Control': 'private, no-store' } });
}
