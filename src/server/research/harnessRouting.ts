import { AiProvider } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { researchTier, type ResearchStage } from '@/lib/research/workflow';
import { AiConfigurationError, lockAiProviderSettings, resolveAiConfigForProvider, resolveConfiguredProviderFields, resolveDefaultAiConfig } from '@/server/brain/config';
import { ResearchError } from './workspace';

const model = z.string().trim().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/);
export const routingInput = z.strictObject({
  fastProvider: z.enum(AiProvider).nullable(),
  fastModel: model.nullable(),
  reviewProvider: z.enum(AiProvider).nullable(),
  reviewModel: model.nullable(),
}).refine(value => (!value.fastModel || value.fastProvider) && (!value.reviewModel || value.reviewProvider), 'Select a provider for each model override.');

const selectRouting = { fastProvider: true, fastModel: true, reviewProvider: true, reviewModel: true } as const;
export async function getResearchRouting(userId: string) {
  return await prisma.researchModelRouting.findUnique({ where: { userId }, select: selectRouting }) ??
    { fastProvider: null, fastModel: null, reviewProvider: null, reviewModel: null };
}

export async function saveResearchRouting(userId: string, input: z.infer<typeof routingInput>) {
  return prisma.$transaction(async tx => {
    await lockAiProviderSettings(tx, userId);
    for (const [provider, override] of [[input.fastProvider, input.fastModel], [input.reviewProvider, input.reviewModel]] as const) {
      if (!provider) continue;
      const config = await tx.aiProviderConfig.findUnique({ where: { userId_provider: { userId, provider } } });
      if (!config) throw new ResearchError('Save that AI provider in Settings before routing Research to it.', 422);
      resolveConfiguredProviderFields({ ...config, model: override ?? config.model, hasApiKey: Boolean(config.apiKeyCipher) });
    }
    return tx.researchModelRouting.upsert({ where: { userId }, create: { userId, ...input }, update: input, select: selectRouting });
  });
}

export async function routeResearchModel(userId: string, stage: ResearchStage['stage']) {
  const routing = await getResearchRouting(userId);
  const fast = researchTier(stage) === 'fast';
  const provider = fast ? routing.fastProvider : routing.reviewProvider;
  const modelOverride = fast ? routing.fastModel : routing.reviewModel;
  try {
    const config = provider ? await resolveAiConfigForProvider(userId, provider, { modelOverride }) : await resolveDefaultAiConfig(userId);
    if (!config) throw new ResearchError('Choose a default AI provider or configure Research routing in Settings.', 422);
    return config;
  } catch (error) {
    if (error instanceof AiConfigurationError) throw new ResearchError(error.message, error.status);
    throw error;
  }
}
