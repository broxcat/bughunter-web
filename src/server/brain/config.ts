import { prisma } from '@/lib/prisma';
import { decryptSecret } from '@/lib/crypto';
import type { Prisma } from '@prisma/client';
import { PROVIDERS, type AiProviderName } from './providers';

export class AiConfigurationError extends Error {
  readonly code = 'FAILED_PROVIDER_CONFIGURATION';
  constructor(message: string, readonly status = 422) { super(message); this.name = 'AiConfigurationError'; }
}
export type ResolvedAiConfig = { configId: string; provider: AiProviderName; model: string; effectiveBaseUrl: string; apiKey?: string };

/** Validate saved settings without decrypting credentials or contacting a provider. */
export function resolveConfiguredProviderFields(input: { provider: string; model?: string | null; baseUrl?: string | null; hasApiKey: boolean }) {
  if (!Object.hasOwn(PROVIDERS, input.provider)) throw new AiConfigurationError('This AI provider is unsupported.');
  const provider = input.provider as AiProviderName, spec = PROVIDERS[provider], model = input.model?.trim();
  if (!model || model.length > 200 || /[\x00-\x1f\x7f]/.test(model)) throw new AiConfigurationError('Set a model in Settings before selecting this provider as default.');
  if (!spec.keyless && !input.hasApiKey) throw new AiConfigurationError('Save an API key in Settings before selecting this provider as default.');
  const baseUrl = input.baseUrl?.trim() || spec.defaultBaseUrl;
  if (!baseUrl) throw new AiConfigurationError('Set an explicit base URL in Settings for this provider.');
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new AiConfigurationError('Set a valid HTTP or HTTPS provider base URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new AiConfigurationError('Use an HTTP or HTTPS base URL without credentials, query parameters or fragments.');
  return { provider, model, effectiveBaseUrl: url.toString().replace(/\/+$/, '') };
}

/** Serialize every save/default change for one owner, including legacy API saves. */
export async function lockAiProviderSettings(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
  if (!rows.length) throw new AiConfigurationError('User unavailable.', 404);
}

function providerKey(provider: AiProviderName, cipher: string | null): string | undefined {
  if (PROVIDERS[provider].keyless) return undefined;
  if (!cipher) throw new AiConfigurationError('The selected provider no longer has an API key in Settings.');
  try { const key = decryptSecret(cipher).trim(); if (key) return key; } catch { /* Never expose cipher/decryption diagnostics. */ }
  throw new AiConfigurationError('The provider API key is unavailable. Save the key again in Settings.');
}

/** Credentials for a captured job come from its provider, never today's default.
 * Model and endpoint edits cannot rewrite the job's captured configuration. */
export async function resolveProviderApiKey(userId: string, provider: AiProviderName) {
  if (!Object.hasOwn(PROVIDERS, provider)) throw new AiConfigurationError('The captured AI provider is unsupported.');
  const config = await prisma.aiProviderConfig.findUnique({ where: { userId_provider: { userId, provider } }, select: { apiKeyCipher: true } });
  if (!config) throw new AiConfigurationError('The captured provider configuration is unavailable in Settings.');
  return providerKey(provider, config.apiKeyCipher);
}

export async function resolveAiConfigForProvider(userId: string, provider: AiProviderName, options: { includeApiKey?: boolean; modelOverride?: string | null } = {}): Promise<ResolvedAiConfig> {
  const config = await prisma.aiProviderConfig.findUnique({ where: { userId_provider: { userId, provider } } });
  if (!config) throw new AiConfigurationError('Save this provider configuration in Settings first.');
  const fields = resolveConfiguredProviderFields({ ...config, model: options.modelOverride ?? config.model, hasApiKey: Boolean(config.apiKeyCipher) });
  return { configId: config.id, ...fields, ...(options.includeApiKey === false ? {} : { apiKey: providerKey(fields.provider, config.apiKeyCipher) }) };
}

/** isActive is the sole persisted default. No environment/provider fallback. */
export async function resolveDefaultAiConfig(userId: string, options: { includeApiKey?: boolean } = {}): Promise<ResolvedAiConfig | null> {
  const config = await prisma.aiProviderConfig.findFirst({ where: { userId, isActive: true }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }] });
  if (!config) return null;
  const fields = resolveConfiguredProviderFields({ ...config, hasApiKey: Boolean(config.apiKeyCipher) });
  return { configId: config.id, ...fields, ...(options.includeApiKey === false ? {} : { apiKey: providerKey(fields.provider, config.apiKeyCipher) }) };
}
