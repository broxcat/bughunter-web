import { prisma } from '@/lib/prisma';
import { ResearchError } from '../research/workspace';

/** Bounded raw output per host. Stored evidence is never truncated or deleted. */
export const RAW_LOG_LINES_PER_RUN = 200;

/**
 * Load one program-level Recon run with everything the execution view needs.
 *
 * Only persisted execution data is exposed: no command is reconstructed from a
 * tool name, and a missing field stays missing rather than being inferred.
 */
export async function loadTargetReconRun(userId: string, runId: string) {
  const run = await prisma.targetReconRun.findFirst({
    where: { id: runId, program: { ownerId: userId } },
    select: {
      id: true,
      status: true,
      outcome: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      program: {
        select: {
          id: true,
          companyName: true,
          platform: true,
          requiredUserAgent: true,
          assessmentMode: true,
        },
      },
      scans: {
        orderBy: [{ reconOrder: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          status: true,
          outcome: true,
          createdAt: true,
          startedAt: true,
          finishedAt: true,
          error: true,
          requiredUserAgent: true,
          reconPlan: true,
          toolVersions: true,
          authenticatedContextsSnapshot: true,
          scopeAsset: { select: { id: true, normalizedValue: true, type: true, assetValue: true } },
          reconSteps: {
            orderBy: { position: 'asc' },
            select: { name: true, state: true, reason: true, capability: true, details: true, startedAt: true, finishedAt: true },
          },
          _count: { select: { artifacts: true, discoveries: true } },
        },
      },
    },
  });
  if (!run) throw new ResearchError('Recon run not found', 404);

  const scanIds = run.scans.map(scan => scan.id);
  // Per-run `take` keeps the payload bounded; an unbounded cross-run query
  // would pull every historical log line for a large Target.
  const [kindCounts, logBuckets] = scanIds.length
    ? await Promise.all([
        prisma.reconArtifact.groupBy({ by: ['scanRunId', 'kind'], where: { scanRunId: { in: scanIds } }, _count: true }),
        Promise.all(scanIds.map(scanRunId => prisma.scanLog.findMany({
          where: { scanRunId },
          orderBy: { createdAt: 'desc' },
          take: RAW_LOG_LINES_PER_RUN,
          select: { line: true, stream: true, createdAt: true },
        }))),
      ])
    : [[], []];

  const observations: Record<string, Array<{ kind: string; count: number }>> = {};
  for (const row of kindCounts) {
    (observations[row.scanRunId] ??= []).push({ kind: row.kind, count: row._count });
  }
  for (const rows of Object.values(observations)) rows.sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));

  // Newest-first from the database, then restored to chronological order for
  // reading. Each run is already bounded by `RAW_LOG_LINES_PER_RUN`.
  const logsByRun: Record<string, Array<{ line: string; stream: 'STDOUT' | 'STDERR'; createdAt: Date }>> = {};
  scanIds.forEach((scanRunId, index) => {
    const rows = logBuckets[index] ?? [];
    logsByRun[scanRunId] = [...rows].reverse();
  });

  return { run, observations, logs: logsByRun, rawLogLimit: RAW_LOG_LINES_PER_RUN };
}
