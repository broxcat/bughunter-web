// Brain entry point. The shared configuration resolver selects the persisted
// default and decrypts credentials server-side only for inference.

import { BrainClient } from "./client";
import { resolveDefaultAiConfig } from './config';
export { resolveDefaultAiConfig, resolveAiConfigForProvider, resolveProviderApiKey, resolveConfiguredProviderFields, AiConfigurationError } from './config';
export type { ResolvedAiConfig } from './config';

export { BrainClient, BrainError } from "./client";
export type { BrainConfig, ChatOptions } from "./client";
export { PROVIDERS } from "./providers";
export type { AiProviderName, ProviderKind } from "./providers";

// High-level, DB-driven helpers (see ./triage). Additive — the exports above
// are unchanged.
export { triageFinding, interpretScan, writeReport } from "./triage";
export type {
  TriageFindingInput,
  TriageSuggestion,
  InterpretFinding,
  WriteReportInput,
} from "./triage";

/**
 * Build a BrainClient for a user's valid default, or null if none is selected.
 */
export async function resolveDefaultBrain(
  userId: string,
): Promise<BrainClient | null> {
  const cfg = await resolveDefaultAiConfig(userId);
  if (!cfg) return null;

  return new BrainClient({
    provider: cfg.provider,
    apiKey: cfg.apiKey,
    model: cfg.model,
    baseUrl: cfg.effectiveBaseUrl,
  });
}

/**
 * Convenience: run one chat against the user's active provider. Returns null if
 * no provider is configured (so callers can degrade to non-LLM behavior).
 */
export async function chatDefault(
  userId: string,
  system: string,
  user: string,
  opts?: Parameters<BrainClient["chat"]>[2],
): Promise<string | null> {
  const brain = await resolveDefaultBrain(userId);
  if (!brain) return null;
  return brain.chat(system, user, opts);
}
// Backward-compatible names for existing finding-assistance callers.
export const resolveActiveBrain = resolveDefaultBrain;
export const chatWithActiveProvider = chatDefault;
