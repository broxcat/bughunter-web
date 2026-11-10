import { auth } from "@/lib/auth";
import { foreignOrigin } from "@/lib/requestOrigin";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { PROVIDERS } from "@/server/brain/providers";
import { testProviderConnection } from "@/server/brain/testConnection";
import { AiProvider } from "@prisma/client";
import { z } from "zod";
export async function POST(req: Request) {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (foreignOrigin(req))
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const parsed = z
    .object({
      provider: z.enum(AiProvider),
      model: z.string().max(200).optional(),
      baseUrl: z.string().max(2000).optional(),
      apiKey: z.string().max(10000).optional(),
    })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "Invalid configuration" }, { status: 400 });
  const input = parsed.data,
    saved = await prisma.aiProviderConfig.findUnique({
      where: { userId_provider: { userId, provider: input.provider } },
    });
  let key = input.apiKey?.trim();
  if (!key && saved?.apiKeyCipher) {
    try {
      key = decryptSecret(saved.apiKeyCipher);
    } catch {
      return Response.json({ result: "Invalid API key" });
    }
  }
  const result = await testProviderConnection({
    provider: input.provider,
    model: input.model ?? saved?.model ?? "",
    baseUrl:
      input.baseUrl ??
      saved?.baseUrl ??
      PROVIDERS[input.provider].defaultBaseUrl ??
      "",
    apiKey: key,
  });
  return Response.json(
    { result },
    { headers: { "Cache-Control": "no-store" } },
  );
}
