import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { campaignActivity, targetCampaign, type CampaignFacts } from '@/lib/targetCampaign';
import { programPolicyInclude, resolveProgramPolicy } from './programExecutionPolicy';
import { campaignPolicyBlocker } from './campaignOrchestrator';
import { pendingScopeSchema } from '@/lib/campaignSource';

type Database = Pick<Prisma.TransactionClient, '$queryRaw'>;

export const campaignProgramSelect = {
  ...programPolicyInclude,
  id: true, ownerId: true, companyName: true, platform: true, deletingAt: true,
  requiredUserAgent: true, programUrl: true, outOfScope: true, rulesOfEngagement: true,
  _count: { select: { scopeAssets: { where: { active: true } } } },
  campaign: { select: { state: true, reason: true, retryAt: true, nextCycleAt: true, pendingAssets: true, handoffRunId: true } },
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
        SELECT 1 FROM "ScanRun" s WHERE s."scopeAssetId" = a.id
          AND (s."targetReconRunId" = r.id OR (r."campaignKey" IS NOT NULL AND s.status = 'COMPLETED' AND s.outcome IN ('SUCCESS','PARTIAL')
            AND a."updatedAt" <= COALESCE(s."startedAt", s."createdAt")))
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
      COALESCE(progress.running, 0) AS "reconRunning",
      standalone.total AS "standaloneTotal", standalone.running AS "standaloneRunning", c.state::text AS "campaignState",
      research.creating AS "researchCreating", research.ready AS "researchReady", research.failed AS "researchFailed",
      ${findingCounts}
    FROM "BountyProgram" p
    LEFT JOIN "TargetCampaign" c ON c."programId" = p.id
    LEFT JOIN LATERAL (
      SELECT id, status, outcome, "scopeMarkdown", "finishedAt", "campaignKey" FROM "TargetReconRun"
      WHERE "programId" = p.id ORDER BY "createdAt" DESC, id DESC LIMIT 1
    ) r ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE s.status NOT IN ('QUEUED','RUNNING'))::int AS finished,
        COUNT(*) FILTER (WHERE s.status = 'RUNNING')::int AS running
      FROM "ScanRun" s WHERE s."targetReconRunId" = r.id AND r.status IN ('QUEUED','RUNNING')
    ) progress ON true
    CROSS JOIN LATERAL (
      SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE s.status = 'RUNNING')::int AS running
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
  const policyBlocker = campaignPolicyBlocker(program);
  let automationBlock;
  try {
    const resolved = resolveProgramPolicy(program);
    if (!program.deletingAt && resolved.automationBlocked && resolved.automationProhibition) automationBlock = { phrase: resolved.automationProhibition, version: resolved.version };
  } catch { /* Invalid configuration still displays the existing policy blocker. */ }
  const row = program.campaign;
  const campaign = row ? { state: row.state, reason: row.reason, retryAt: row.retryAt, nextCycleAt: row.nextCycleAt,
    handoffRunId: row.handoffRunId, pendingCount: pendingScopeSchema.safeParse(row.pendingAssets).data?.length ?? 0 } : null;
  return { policyBlocker, ...targetCampaign({ ...program, campaign, assetCount: program._count.scopeAssets,
    policyBlocker, automationBlock }, facts) };
}

async function loadReconSummary(db: Database, runId: string) {
  const [row] = await db.$queryRaw<{ hosts: number; webApps: number; added: number; changed: number; notObserved: number }[]>`
    WITH scans AS (SELECT id, "changeSet" FROM "ScanRun" WHERE "targetReconRunId" = ${runId}),
    observations AS (
      SELECT a.kind, a.value, a.verification FROM "ReconArtifact" a JOIN scans s ON s.id = a."scanRunId"
      WHERE a."scopeState" = 'IN_SCOPE' AND a.kind IN ('hostname','endpoint')
    )
    SELECT (
      SELECT COUNT(DISTINCT value->>'hostname')::int FROM observations WHERE kind = 'hostname'
    ) AS hosts, (
      SELECT COUNT(DISTINCT substring(value->>'url' FROM '^https?://[^/?#]+'))::int FROM observations
      WHERE kind = 'endpoint' AND verification = 'OBSERVED'
    ) AS "webApps",
    COALESCE(SUM(CASE WHEN jsonb_typeof("changeSet"->'new') = 'array' THEN jsonb_array_length("changeSet"->'new') ELSE 0 END), 0)::int AS added,
    COALESCE(SUM(CASE WHEN jsonb_typeof("changeSet"->'changed') = 'array' THEN jsonb_array_length("changeSet"->'changed') ELSE 0 END), 0)::int AS changed,
    COALESCE(SUM(CASE WHEN jsonb_typeof(COALESCE("changeSet"->'notObserved', "changeSet"->'removed')) = 'array'
      THEN jsonb_array_length(COALESCE("changeSet"->'notObserved', "changeSet"->'removed')) ELSE 0 END), 0)::int AS "notObserved"
    FROM scans`;
  return row ?? null;
}

export function loadTargetCampaign(ownerId: string, id: string) {
  return prisma.$transaction(async tx => {
    const program = await tx.bountyProgram.findFirst({ where: { id, ownerId }, select: campaignProgramSelect });
    if (!program) return null;
    const facts = (await campaignFacts(tx, ownerId, [id])).get(id)!;
    const view = campaignView(program, facts);
    const summary = facts.runId && view.stages[1].state === 'done' ? await loadReconSummary(tx, facts.runId) : null;
    return { program, view, summary };
  }, { isolationLevel: 'RepeatableRead' });
}

export async function loadCampaignActivity(ownerId: string, ids: string[]) {
  const facts = await campaignFacts(prisma, ownerId, ids, true);
  return ids.map(id => {
    const row = facts.get(id);
    return row ? { id, ...campaignActivity(row) } : null;
  });
}
