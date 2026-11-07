import {Prisma} from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { listTargetAssets } from '@/server/recon/intelligence';
import { backfillProgramAssets,lockOwnedProgram,assetError } from '@/server/scopeAssets';
import { paginationInput } from '@/lib/pagination';
export async function GET(req: Request) {
  const s = await auth();
  if (!s?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = s.user.id, params = new URL(req.url).searchParams;
  let input;
  try { if (params.has('page') || params.has('pageSize')) input = paginationInput(params); }
  catch { return Response.json({ error: 'Invalid page or pageSize' }, { status: 400 }); }
  try {
    const target = params.get('target') || undefined;
    // Compatibility backfill must visit every owned Program. Keyset batches
    // bound memory without truncating authorization records after the first 1000.
    let cursor: string | undefined;
    for (;;) {
      const programs = await prisma.$queryRaw<{id:string}[]>(Prisma.sql`
        SELECT p.id FROM "BountyProgram" p
        WHERE p."ownerId"=${userId} AND p."deletingAt" IS NULL
          ${target ? Prisma.sql`AND p.id=${target}` : Prisma.empty}
          ${cursor ? Prisma.sql`AND p.id>${cursor}` : Prisma.empty}
          AND (EXISTS (SELECT 1 FROM unnest(p."scopeRules") AS rule(value)
            WHERE NOT EXISTS (SELECT 1 FROM "ScopeAsset" a WHERE a."programId"=p.id AND a."originalValue"=rule.value))
            OR EXISTS (SELECT 1 FROM "Target" t WHERE t."programId"=p.id AND t."userId"=${userId}
              AND t.active AND NOT t."contextOnly" AND t."discoverySource" IS NULL AND t."scopeAssetId" IS NULL))
        ORDER BY p.id ASC LIMIT 100`);
      for (const p of programs) await prisma.$transaction(async tx => {
        await lockOwnedProgram(tx, userId, p.id); await backfillProgramAssets(tx, p.id, userId);
      });
      if (programs.length < 100) break;
      cursor = programs.at(-1)!.id;
    }
    const result = await listTargetAssets(userId, target, input);
    return Response.json(input ? result : result.items, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return assetError(e); }
}
