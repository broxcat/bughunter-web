import { prisma } from '@/lib/prisma';
import { ResearchError } from '../research/workspace';
import { readAuthSurface } from '../authenticatedRecon';
import { exportAuthSurfaces } from './authExport';
import type { ReportFacts, ReportArtifact, ReportScan } from '@/lib/reconReportModel';

/** Evidence rows bounded per host; counts still reflect the complete stored set. */
export const REPORT_ARTIFACTS_PER_HOST = 400;

function contextsCount(snapshot: unknown): number {
  return Array.isArray(snapshot) ? snapshot.length : 0;
}

/**
 * Read the persisted facts a deterministic Recon report is built from.
 * No AI, no network, no scope mutation.
 */
export async function loadReconReportFacts(userId: string, runId: string): Promise<ReportFacts> {
  const run = await prisma.targetReconRun.findFirst({
    where: { id: runId, program: { ownerId: userId } },
    select: {
      id: true, status: true, outcome: true, createdAt: true, startedAt: true, finishedAt: true,
      program: {
        select: {
          id: true, companyName: true, platform: true, requiredUserAgent: true,
          outOfScope: true, rulesOfEngagement: true, assessmentMode: true,
        },
      },
      scans: {
        orderBy: [{ reconOrder: 'asc' }, { id: 'asc' }],
        select: {
          id: true, status: true, outcome: true, startedAt: true, finishedAt: true,
          requiredUserAgent: true, reconPlan: true, toolVersions: true,
          authenticatedContextsSnapshot: true, changeSet: true,
          scopeAsset: { select: { normalizedValue: true } },
          reconSteps: { orderBy: { position: 'asc' }, select: { name: true, state: true, reason: true, details: true } },
          _count: { select: { artifacts: true } },
        },
      },
    },
  });
  if (!run) throw new ResearchError('Recon run not found', 404);

  const assets = await prisma.scopeAsset.findMany({
    where: { programId: run.program.id, active: true },
    select: { normalizedValue: true },
    orderBy: { normalizedValue: 'asc' },
    take: 1000,
  });

  const scanIds = run.scans.map(scan => scan.id);
  const artifactRows = scanIds.length
    ? await prisma.reconArtifact.findMany({
        where: { scanRunId: { in: scanIds } },
        orderBy: [{ kind: 'asc' }, { canonicalKey: 'asc' }],
        select: { scanRunId: true, kind: true, value: true },
        take: REPORT_ARTIFACTS_PER_HOST * Math.max(1, scanIds.length),
      })
    : [];

  const artifactsByRun = new Map<string, ReportArtifact[]>();
  for (const row of artifactRows) {
    const bucket = artifactsByRun.get(row.scanRunId) ?? [];
    if (bucket.length < REPORT_ARTIFACTS_PER_HOST) bucket.push({ kind: row.kind, value: (row.value ?? {}) as Record<string, unknown> });
    artifactsByRun.set(row.scanRunId, bucket);
  }

  const surfaces = scanIds.length ? exportAuthSurfaces(await readAuthSurface(scanIds)) : [];

  const scans: ReportScan[] = run.scans.map(scan => ({
    host: scan.scopeAsset?.normalizedValue ?? null,
    status: scan.status,
    outcome: scan.outcome,
    startedAt: scan.startedAt?.toISOString() ?? null,
    finishedAt: scan.finishedAt?.toISOString() ?? null,
    requiredUserAgent: scan.requiredUserAgent,
    authenticatedContexts: contextsCount(scan.authenticatedContextsSnapshot),
    plan: (scan.reconPlan ?? null) as ReportScan['plan'],
    steps: scan.reconSteps.map(step => ({ name: step.name, state: step.state, reason: step.reason, details: step.details })),
    artifacts: artifactsByRun.get(scan.id) ?? [],
    artifactCount: scan._count.artifacts,
    changeSet: scan.changeSet,
    toolVersions: scan.toolVersions,
  }));

  return {
    run: {
      id: run.id,
      status: run.status,
      outcome: run.outcome,
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
    },
    program: {
      companyName: run.program.companyName,
      platform: run.program.platform,
      requiredUserAgent: run.program.requiredUserAgent,
      outOfScope: run.program.outOfScope,
      rulesOfEngagement: run.program.rulesOfEngagement,
      assessmentMode: run.program.assessmentMode,
    },
    authorizedAssets: assets.map(asset => asset.normalizedValue),
    scans,
    authSurfaces: surfaces.map(surface => ({
      contexts: surface.contexts.map(context => ({ label: context.label })),
      totals: surface.totals,
    })),
  };
}
