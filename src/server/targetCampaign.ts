import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { campaignActivity, targetCampaign, type CampaignFacts } from '@/lib/targetCampaign';
import { programPolicyBlocker, programPolicyInclude } from './programExecutionPolicy';

type Database = Pick<Prisma.TransactionClient, '$queryRaw'>;

export const campaignProgramSelect = {
  ...programPolicyInclude,
  id: true, ownerId: true, companyName: true, platform: true, deletingAt: true,
  requiredUserAgent: true, programUrl: true, outOfScope: true, rulesOfEngagement: true,
  _count: { select: { scopeAssets: { where: { active: true } } } },
} satisfies Prisma.BountyProgramSelect;

type CampaignProgram = Prisma.BountyProgramGetPayload<{ select: typeof campaignProgramSelect }>;

/** One bounded read for the current page. No run logs, workspace bodies or past
 * artifact inventory cross this read model. The snapshot comparison matches
 * the existing target-wide Recon readiness check. */
export async function campaignFacts(db: Database, ownerId: string, ids: string[], liveOnly = false) {
  if (!ids.length) return new Map<string, CampaignFacts>();
  const scopeCurrent = liveOnly ? Prisma.sql`false` : Prisma.sql`
    r.id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "ScopeAsset" a WHERE a."programId" = p.id AND a.active AND NOT EXISTS (
        SELECT 1 FROM "ScanRun" s WHERE s."targetReconRunId" = r.id AND s."scopeAssetId" = a.id
          AND s."scopeAssetSnapshot"->>'normalizedValue' = a."normalizedValue"
          AND s."scopeAssetSnapshot"->>'format' = a.format::text
          AND s."scopeAssetSnapshot"->>'type' = a.type::text
          AND s."scopeAssetSnapshot"->>'assetValue' = a."assetValue"::text
      )
    )`;
  const findingCounts = liveOnly ? Prisma.sql`0 AS findings, 0 AS "reviewedFindings"` : Prisma.sql`
    COALESCE(f.total, 0) AS findings, COALESCE(f.reviewed, 0) AS "reviewedFindings"`;
  const findingJoin = liveOnly ? Prisma.empty : Prisma.sql`
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE f."reviewStatus" IN ('CONFIRMED','REJECTED','INCONCLUSIVE')
        OR (f."reviewStatus" = 'CANDIDATE' AND (f."reviewEvidence" IS NULL OR f."reviewEvidence" = 'null'::jsonb)
          AND f."gateStatus" IN ('PASSED','KILLED')))::int AS reviewed
      FROM "Target" t JOIN "Finding" f ON f."targetId" = t.id
      WHERE t."programId" = p.id AND t."userId" = p."ownerId"
    ) f ON true`;
  const rows = await db.$queryRaw<CampaignFacts[]>(Prisma.sql`
    SELECT p.id AS "programId", r.id AS "runId", r.status::text AS "runStatus", r.outcome::text AS "runOutcome",
      COALESCE(octet_length(r."scopeMarkdown") > 0, false) AS "hasHandoff",
      COALESCE(r.status = 'COMPLETED' AND r.outcome IN ('SUCCESS','PARTIAL') AND r."scopeMarkdown" IS NULL
        AND r."finishedAt" > NOW() - INTERVAL '12 seconds', false) AS "handoffPending",
      (${scopeCurrent}) AS "scopeCurrent",
      COALESCE(progress.total, 0) AS "reconTotal", COALESCE(progress.finished, 0) AS "reconFinished",
      standalone.total AS "standaloneTotal",
      research.creating AS "researchCreating", research.ready AS "researchReady", research.failed AS "researchFailed",
      ${findingCounts}
    FROM "BountyProgram" p
    LEFT JOIN LATERAL (
      SELECT id, status, outcome, "scopeMarkdown", "finishedAt" FROM "TargetReconRun"
      WHERE "programId" = p.id ORDER BY "createdAt" DESC, id DESC LIMIT 1
    ) r ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE s.status NOT IN ('QUEUED','RUNNING'))::int AS finished
      FROM "ScanRun" s WHERE s."targetReconRunId" = r.id AND r.status IN ('QUEUED','RUNNING')
    ) progress ON true
    CROSS JOIN LATERAL (
      SELECT COUNT(*)::int AS total
      FROM "ScopeAsset" a JOIN "ScanRun" s ON s."scopeAssetId" = a.id
      WHERE a."programId" = p.id AND a.active AND s."targetReconRunId" IS NULL AND s.type = 'RECON' AND s.status IN ('QUEUED','RUNNING')
    ) standalone
    CROSS JOIN LATERAL (
      SELECT COUNT(*) FILTER (WHERE w.status = 'CREATING')::int AS creating,
        COUNT(*) FILTER (WHERE w.status = 'READY')::int AS ready,
        COUNT(*) FILTER (WHERE w.status = 'FAILED')::int AS failed
      FROM "Target" t JOIN "ResearchSession" w ON w."targetId" = t.id AND w."userId" = p."ownerId"
      LEFT JOIN "ScopeAsset" a ON a.id = t."scopeAssetId"
      LEFT JOIN "ScopeAsset" d ON d.id = t."discoveredFromAssetId"
      WHERE t."programId" = p.id AND t."userId" = p."ownerId" AND w."consoleTargetId" IS NOT NULL
        AND (a.active OR d.active OR t."contextOnly" OR (t.active AND t."scopeAssetId" IS NULL AND t."discoveredFromAssetId" IS NULL))
    ) research
    ${findingJoin}
    WHERE p."ownerId" = ${ownerId} AND p.id IN (${Prisma.join(ids)})
  `);
  return new Map(rows.map(row => [row.programId, row]));
}

export function campaignView(program: CampaignProgram, facts: CampaignFacts) {
  const policyBlocker = programPolicyBlocker(program);
  return { policyBlocker, ...targetCampaign({ ...program, assetCount: program._count.scopeAssets, policyBlocker }, facts) };
}

export function loadTargetCampaign(ownerId: string, id: string) {
  return prisma.$transaction(async tx => {
    const program = await tx.bountyProgram.findFirst({ where: { id, ownerId }, select: campaignProgramSelect });
    if (!program) return null;
    const facts = (await campaignFacts(tx, ownerId, [id])).get(id)!;
    return { program, view: campaignView(program, facts) };
  }, { isolationLevel: 'RepeatableRead' });
}

export async function loadCampaignActivity(ownerId: string, ids: string[]) {
  const facts = await campaignFacts(prisma, ownerId, ids, true);
  return ids.map(id => {
    const row = facts.get(id);
    return row ? { id, ...campaignActivity(row) } : null;
  });
}
