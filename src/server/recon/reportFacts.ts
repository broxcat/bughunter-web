import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authContextCount } from '@/lib/reconTimeline';
import { ResearchError } from '../research/workspace';
import { readAuthSurface } from '../authenticatedRecon';
import { exportAuthSurfaces } from './authExport';
import type { ReportFacts, ReportArtifact, ReportScan } from '@/lib/reconReportModel';

const reportScanSelect = {
          id: true, scopeAssetId:true, status: true, outcome: true, startedAt: true, finishedAt: true,
          scopeAssetSnapshot: true, requiredUserAgent: true, reconPlan: true, toolVersions: true,
          authenticatedContextsSnapshot: true, changeSet: true,
          reconSteps: { orderBy: { position: 'asc' }, select: { id: true, name: true, state: true, reason: true, details: true } },
          _count: { select: { artifacts: true } },
        } satisfies Prisma.ScanRunSelect;

/** Evidence rows bounded per host; counts still reflect the complete stored set. */
export const REPORT_ARTIFACTS_PER_HOST = 400;

/** A single retained asset run uses the same model and evidence budgets as parent reports.
 * For standalone context, facts.run.id is the real ScanRun; consumers must not
 * label it a TargetReconRun. Current scope context renders explicit stored IDs.
 */
export async function loadAssetReportFacts(userId: string, programId: string, scanId: string): Promise<ReportFacts> {
  const scan = await prisma.scanRun.findFirst({
    where: { id: scanId, type: 'RECON', scopeAsset: { programId, program: { ownerId: userId } }, target: { userId } },
    select: { ...reportScanSelect, createdAt: true, assessmentModeSnapshot: true,
      scopeAsset: { select: { program: { select: { companyName: true, platform: true } } } } },
  });
  if (!scan?.scopeAsset) throw new ResearchError('Recon run not found', 404);
  return reportFacts({ ...scan, program: scan.scopeAsset.program, scans: [scan] });
}
export async function loadReconReportFacts(userId: string, runId: string): Promise<ReportFacts> {
  const run = await prisma.targetReconRun.findFirst({
    where: { id: runId, program: { ownerId: userId } },
    select: {
      assessmentModeSnapshot: true, id: true, status: true, outcome: true, createdAt: true, startedAt: true, finishedAt: true,
      program: {
        select: {
          id: true, companyName: true, platform: true,
        },
      },
      scans: {
        orderBy: [{ reconOrder: 'asc' }, { id: 'asc' }],
        select: reportScanSelect,
      },
    },
  });
  if (!run) throw new ResearchError('Recon run not found', 404);

  return reportFacts(run);
}

async function reportFacts(run: {
  id: string; status: ReportFacts['run']['status']; outcome: ReportFacts['run']['outcome'];
  createdAt: Date; startedAt: Date | null; finishedAt: Date | null; assessmentModeSnapshot: string | null;
  program: { companyName: string; platform: string | null };
  scans: Prisma.ScanRunGetPayload<{select: typeof reportScanSelect}>[];
}): Promise<ReportFacts> {
  // Bound each host independently. A noisy first host must never consume the
  // report budget of another host. Retained artifacts themselves are unchanged.
  const scanIds = run.scans.map(scan => scan.id);
  const buckets = await Promise.all(scanIds.map(scanRunId => prisma.reconArtifact.findMany({
    where: { scanRunId },
    orderBy: [{ kind: 'asc' }, { canonicalKey: 'asc' }, { id: 'asc' }],
    select: { id:true,kind:true,value:true,verification:true,scopeState:true,sources:true,firstSeenAt:true,lastSeenAt:true },
    take: REPORT_ARTIFACTS_PER_HOST,
  })));
  const artifactsByRun = new Map<string, ReportArtifact[]>(scanIds.map((id, index) => [id,
    buckets[index].map(row => ({ id:row.id,sources:row.sources,scopeState:row.scopeState,firstSeenAt:row.firstSeenAt.toISOString(),lastSeenAt:row.lastSeenAt.toISOString(),kind: row.kind, verification: row.verification, value: (row.value ?? {}) as Record<string, unknown> })),
  ]));
  // Authorization comes from captured boundaries, never today's mutable assets.
  const captured = run.scans.map(scan => scan.scopeAssetSnapshot as { normalizedValue?: string } | null);
  const plans = run.scans.map(scan => scan.reconPlan as ReportScan['plan']);
  const userAgents = [...new Set(run.scans.map(scan => scan.requiredUserAgent).filter((v): v is string => Boolean(v)))];

  const surfaces = scanIds.length ? exportAuthSurfaces(await readAuthSurface(scanIds)) : [];

  const scans: ReportScan[] = run.scans.map((scan, index) => ({
    id: scan.id,
    scopeAssetId: scan.scopeAssetId ?? (scan.scopeAssetSnapshot as {assetId?:string}|null)?.assetId ?? null,
    host: captured[index]?.normalizedValue ?? plans[index]?.boundary?.normalizedValue ?? null,
    status: scan.status,
    outcome: scan.outcome,
    startedAt: scan.startedAt?.toISOString() ?? null,
    finishedAt: scan.finishedAt?.toISOString() ?? null,
    requiredUserAgent: scan.requiredUserAgent,
    authenticatedContexts: authContextCount(scan.authenticatedContextsSnapshot),
    plan: (scan.reconPlan ?? null) as ReportScan['plan'],
    steps: scan.reconSteps.map(step => ({ id: step.id, name: step.name, state: step.state, reason: step.reason, details: step.details })),
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
      requiredUserAgent: userAgents.length ? userAgents.join('; ') : null,
      outOfScope: [...new Set(plans.flatMap(plan => plan?.authorization?.exclusions ?? []))],
      rulesOfEngagement: null, // Not captured by this historical execution contract.
      assessmentMode: run.assessmentModeSnapshot ?? 'NOT_RECORDED',
    },
    authorizedAssets: [...new Set(run.scans.map((scan, index) => captured[index]?.normalizedValue ?? plans[index]?.boundary?.normalizedValue).filter((value): value is string => Boolean(value)))],
    scans,
    authSurfaces: surfaces.map(surface => ({
      observations: surface.observations.filter(row=>Boolean(row.id)).map(row=>({id:row.id!,scanRunId:surface.scanRunId,url:row.url,method:row.method,source:row.source,observedAt:row.observedAt,responseClass:row.responseClass,contextLabel:surface.contexts.find(c=>c.contextKey===row.contextKey)?.label??'Not recorded'})),
      contexts: surface.contexts.map(context => ({ label: context.label, mode: context.mode, state: context.state,
        observations: surface.observations.filter(row => row.contextKey === context.contextKey && !['UNAVAILABLE', 'SESSION_LOST'].includes(row.responseClass)).length,
      })),
      totals: surface.totals,
    })),
  };
}
