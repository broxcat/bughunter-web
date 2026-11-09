import type { Prisma } from '@prisma/client';

export const researchJobSelection = {
  id: true, targetId: true, researchSourceId: true, status: true, startedAt: true, cancelRequestedAt: true, outcome: true,
} as const;

export function campaignResearchJobs(tx: Prisma.TransactionClient, programId: string, handoffId: string) {
  return tx.scanRun.findMany({
    where: { type: 'RESEARCH', target: { programId }, researchHandoffId: handoffId },
    select: researchJobSelection, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
}

export async function queueCampaignResearch(tx: Prisma.TransactionClient, programId: string, ownerId: string, handoffId: string) {
  const handoff = await tx.targetReconRun.findFirstOrThrow({ where: { id: handoffId, programId }, select: { campaignKey: true } });
  const prefix = handoff.campaignKey?.split(':').slice(0, 2).join(':');
  const [sources, jobs] = await Promise.all([
    tx.scanRun.findMany({ where: { type: 'RECON', ...(prefix ? { targetReconRun: { programId, campaignKey: { startsWith: prefix + ':' } } } : { targetReconRunId: handoffId }), target: { programId, userId: ownerId },
      status: 'COMPLETED', outcome: { in: ['SUCCESS', 'PARTIAL'] }, scopeAsset: { programId, active: true },
    }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], distinct: ['scopeAssetId'], select: {
      id: true, targetId: true, scopeAssetId: true, scopeAssetSnapshot: true, scopeAsset: { select: { format: true } },
    } }),
    campaignResearchJobs(tx, programId, handoffId),
  ]);
  if (jobs.some(job => job.status === 'QUEUED' && job.cancelRequestedAt)) return { jobs, queued: 0 };
  const bySource = new Map<string, typeof jobs>();
  for (const job of jobs) {
    const list = bySource.get(job.researchSourceId!) ?? [];
    list.push(job);
    bySource.set(job.researchSourceId!, list);
  }
  let queued = 0;
  for (const source of sources) {
    // Wildcard discovery alone does not authorize an HTTP request. Include
    // only concrete execution hosts that this exact run actually observed.
    const targets = [source.targetId];
    if (source.scopeAsset?.format === 'WILDCARD_DOMAIN') {
      const concrete = await tx.$queryRaw<{ id: string }[]>`
        SELECT t.id FROM "Target" t WHERE t."programId" = ${programId} AND t."userId" = ${ownerId}
          AND t.active AND NOT t."contextOnly" AND t."discoveredFromAssetId" = ${source.scopeAssetId}
          AND EXISTS (
            SELECT 1 FROM "ReconSurfaceObservation" a WHERE a."scanRunId" = ${source.id}
              AND a."contextType" = 'ANONYMOUS' AND NOT a."urlRedacted" AND a.source = 'anonymous-recon'
              AND a."statusCode" > 0 AND split_part(split_part(a.url, '://', 2), '/', 1) = t.host
          )
        ORDER BY t.host, t.id LIMIT 12`;
      targets.push(...concrete.map(target => target.id));
    }
    const history = bySource.get(source.id) ?? [];
    for (const targetId of targets) {
      const previous = history.filter(job => job.targetId === targetId);
      const last = previous.at(-1);
      // Resuming replaces only a queued job that was cancelled before start.
      // Once network work may have begun, the worker never replays that job.
      if (last && (last.status !== 'CANCELLED' || last.startedAt)) continue;
      await tx.scanRun.create({ data: {
        type: 'RESEARCH', targetId, scopeAssetId: source.scopeAssetId,
        ...(source.scopeAssetSnapshot ? { scopeAssetSnapshot: source.scopeAssetSnapshot as Prisma.InputJsonValue } : {}),
        researchSourceId: source.id, researchHandoffId: handoffId, researchKey: [handoffId, source.id, targetId, previous.length + 1].join(':'),
        jobOutbox: { create: {} },
      } });
      queued++;
    }
  }
  return { jobs, queued };
}
