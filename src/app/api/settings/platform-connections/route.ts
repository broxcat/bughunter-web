
import { auth } from '@/lib/auth';
import { encryptSecret } from '@/lib/crypto';
import { platformConnectionSchema, tokenPlatformSchema } from '@/lib/platformConnections';
import { prisma } from '@/lib/prisma';
import { foreignOrigin } from '@/lib/requestOrigin';
import { z } from 'zod';

const privateHeaders = { 'Cache-Control': 'private, no-store' };

export async function GET() {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const connections = await prisma.platformConnection.findMany({
    where: { userId }, select: { platform: true }, orderBy: { platform: 'asc' },
  });
  return Response.json({ connections }, { headers: privateHeaders });
}

export async function PUT(request: Request) {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (foreignOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const parsed = platformConnectionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid platform credentials' }, { status: 400 });
  const { platform } = parsed.data;
  const credentialCipher = encryptSecret(JSON.stringify(parsed.data));
  await prisma.platformConnection.upsert({
    where: { userId_platform: { userId, platform } },
    create: { userId, platform, credentialCipher }, update: { credentialCipher },
  });
  return Response.json({ platform }, { headers: privateHeaders });
}

export async function DELETE(request: Request) {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (foreignOrigin(request)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const parsed = z.strictObject({ platform: tokenPlatformSchema }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid platform' }, { status: 400 });
  await prisma.platformConnection.deleteMany({ where: { userId, platform: parsed.data.platform } });
  return new Response(null, { status: 204, headers: privateHeaders });
}
