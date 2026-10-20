import { prisma } from "@/lib/prisma";

export interface OobHitSummary {
  receivedAt: Date;
  sourceIp: string | null;
  method: string;
}

/**
 * Correlated out-of-band callbacks, grouped by OobHit.token, oldest first. One
 * batched query for any number of tokens (no N+1).
 */
export async function loadOobHitsByToken(
  tokens: string[],
): Promise<Map<string, OobHitSummary[]>> {
  const byToken = new Map<string, OobHitSummary[]>();
  if (tokens.length === 0) return byToken;

  const hits = await prisma.oobHit.findMany({
    where: { token: { in: tokens } },
    orderBy: { receivedAt: "asc" },
    select: { token: true, receivedAt: true, sourceIp: true, method: true },
  });
  for (const h of hits) {
    const list = byToken.get(h.token) ?? [];
    list.push({ receivedAt: h.receivedAt, sourceIp: h.sourceIp, method: h.method });
    byToken.set(h.token, list);
  }
  return byToken;
}
