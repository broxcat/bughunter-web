import { NextResponse } from "next/server";
import { z } from "zod";
import { AiProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { assertProviderEndpoint, EgressError } from '@/server/egress/fetch';
import { foreignOrigin } from '@/lib/requestOrigin';
import { AiConfigurationError, lockAiProviderSettings, resolveConfiguredProviderFields } from '@/server/brain/config';

// Per-user AI provider configuration.
//
// SECURITY: the API key is accepted on POST, immediately encrypted via
// `encryptSecret`, and stored only in `apiKeyCipher`. It is NEVER echoed back.
// GET exposes only a `hasApiKey` boolean, never the cipher or plaintext.

export const runtime = "nodejs"; // node:crypto in encryptSecret requires the Node runtime

const providerValues = Object.values(AiProvider) as [string, ...string[]];

const upsertSchema = z.object({
  provider: z.enum(providerValues),
  // Empty/omitted apiKey => keep the existing cipher untouched.
  apiKey: z.string().optional(),
  model: z.string().trim().max(200).optional(),
  baseUrl: z.string().trim().url().max(2000).optional().or(z.literal("")),
  isActive: z.boolean().optional(),
});

/** GET /api/ai-providers — the caller's own configs, secrets stripped. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const configs = await prisma.aiProviderConfig.findMany({
    where: { userId: session.user.id },
    orderBy: { provider: "asc" },
  });

  // Map to a safe shape: never leak apiKeyCipher or any plaintext.
  const safe = configs.map((c) => ({
    id: c.id,
    provider: c.provider,
    model: c.model,
    baseUrl: c.baseUrl,
    isActive: c.isActive,
    hasApiKey: Boolean(c.apiKeyCipher),
  }));

  return NextResponse.json({ providers: safe });
}

/** POST /api/ai-providers — upsert a config keyed by (userId, provider). */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  if (foreignOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { provider, apiKey, model, baseUrl, isActive } = parsed.data;
  const providerEnum = provider as AiProvider;

  // Only set the cipher when a non-empty key was actually provided. Omitting the
  // key lets the user change model/baseUrl/isActive without re-entering it.
  const hasNewKey = typeof apiKey === "string" && apiKey.trim().length > 0;
  const apiKeyCipher = hasNewKey ? encryptSecret(apiKey!.trim()) : undefined;

  // Normalize optional string fields: "" clears, undefined leaves unchanged.
  const normBaseUrl =
    baseUrl === undefined ? undefined : baseUrl === "" ? null : baseUrl;
  const normModel =
    model === undefined ? undefined : model === "" ? null : model;

  // M1: a user-supplied base URL must resolve to public addresses only, unless
  // it is exactly an operator-defined endpoint (OLLAMA_HOST / embedding URL).
  // Transport re-checks at every call (pinned, no redirects).
  if (normBaseUrl) {
    try { await assertProviderEndpoint(normBaseUrl); }
    catch (error) {
      return NextResponse.json({ error: error instanceof EgressError ? 'Provider base URL must resolve to a public address (private endpoints are configured by the operator).' : 'Provider base URL could not be verified.' }, { status: 400 });
    }
  }

  // Enforce "only one active provider per user": if this one is being activated,
  // deactivate all the others first, atomically with the upsert.
  let config;
  try { config = await prisma.$transaction(async (tx) => {
    await lockAiProviderSettings(tx, userId);
    const current = await tx.aiProviderConfig.findUnique({ where: { userId_provider: { userId, provider: providerEnum } } });
    if (isActive === true || isActive !== false && current?.isActive) resolveConfiguredProviderFields({
      provider, model: normModel === undefined ? current?.model : normModel,
      baseUrl: normBaseUrl === undefined ? current?.baseUrl : normBaseUrl,
      hasApiKey: Boolean(apiKeyCipher ?? current?.apiKeyCipher),
    });
    if (isActive === true) {
      await tx.aiProviderConfig.updateMany({
        where: { userId, provider: { not: providerEnum } },
        data: { isActive: false },
      });
    }

    return tx.aiProviderConfig.upsert({
      where: { userId_provider: { userId, provider: providerEnum } },
      create: {
        userId,
        provider: providerEnum,
        ...(apiKeyCipher !== undefined ? { apiKeyCipher } : {}),
        ...(normModel !== undefined ? { model: normModel } : {}),
        ...(normBaseUrl !== undefined ? { baseUrl: normBaseUrl } : {}),
        isActive: isActive ?? false,
      },
      update: {
        ...(apiKeyCipher !== undefined ? { apiKeyCipher } : {}),
        ...(normModel !== undefined ? { model: normModel } : {}),
        ...(normBaseUrl !== undefined ? { baseUrl: normBaseUrl } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
    });
  }); } catch (error) {
    return NextResponse.json({ error: error instanceof AiConfigurationError ? error.message : 'Provider configuration could not be saved.' }, { status: error instanceof AiConfigurationError ? error.status : 503 });
  }

  // Return the safe shape only — never the cipher.
  return NextResponse.json({
    provider: {
      id: config.id,
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl,
      isActive: config.isActive,
      hasApiKey: Boolean(config.apiKeyCipher),
    },
  });
}
