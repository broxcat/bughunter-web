import { z } from 'zod';
import { AiProvider } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { foreignOrigin } from '@/lib/requestOrigin';
import { AiConfigurationError, lockAiProviderSettings, resolveConfiguredProviderFields } from '@/server/brain/config';

export const runtime = 'nodejs';
const bodySchema = z.strictObject({ provider: z.enum(AiProvider) });
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Select a saved provider.' }, { status: 400 });
  const userId = session.user.id;
  try {
    const config = await prisma.$transaction(async tx => {
      await lockAiProviderSettings(tx, userId);
      const saved = await tx.aiProviderConfig.findUnique({ where: { userId_provider: { userId, provider: parsed.data.provider } } });
      if (!saved) throw new AiConfigurationError('Save this provider configuration in Settings first.');
      resolveConfiguredProviderFields({ ...saved, hasApiKey: Boolean(saved.apiKeyCipher) });
      await tx.aiProviderConfig.updateMany({ where: { userId, isActive: true, id: { not: saved.id } }, data: { isActive: false } });
      return tx.aiProviderConfig.update({ where: { id: saved.id }, data: { isActive: true } });
    });
    return Response.json({ provider: { id: config.id, provider: config.provider, model: config.model, baseUrl: config.baseUrl, isActive: config.isActive, hasApiKey: Boolean(config.apiKeyCipher) } });
  } catch (error) {
    return Response.json({ error: error instanceof AiConfigurationError ? error.message : 'The default provider could not be changed.' }, { status: error instanceof AiConfigurationError ? error.status : 503 });
  }
}
