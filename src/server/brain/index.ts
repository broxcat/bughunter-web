// Brain entry point. Resolves the caller's active AI provider from the database,
// decrypts its API key IN-PROCESS (never exported to another runtime or the
// client), and hands back a configured BrainClient.
//
// This is the only place a provider key is decrypted for inference use. The
// decrypted key lives only inside the returned BrainClient's config for the
// duration of the call.

import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { BrainClient } from "./client";
import type { AiProviderName } from "./providers";

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
 * Build a BrainClient for a user's active provider, or null if they have none.
 * OLLAMA is keyless, so a null cipher is fine there; any other provider with a
 * missing key still returns a client (the call will fail with a clear error).
 */
export async function resolveActiveBrain(
  userId: string,
): Promise<BrainClient | null> {
  const cfg = await prisma.aiProviderConfig.findFirst({
    where: { userId, isActive: true },
  });
  if (!cfg) return null;

  const apiKey = cfg.apiKeyCipher ? decryptSecret(cfg.apiKeyCipher) : null;

  return new BrainClient({
    provider: cfg.provider as AiProviderName,
    apiKey,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
  });
}

/**
 * Convenience: run one chat against the user's active provider. Returns null if
 * no provider is configured (so callers can degrade to non-LLM behavior).
 */
export async function chatWithActiveProvider(
  userId: string,
  system: string,
  user: string,
  opts?: Parameters<BrainClient["chat"]>[2],
): Promise<string | null> {
  const brain = await resolveActiveBrain(userId);
  if (!brain) return null;
  return brain.chat(system, user, opts);
}
