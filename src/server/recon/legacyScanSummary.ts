import { prisma } from '@/lib/prisma';
import { buildScanSummary } from '@/lib/scanSummary';
import type { ReconEvidence } from '@/lib/research/recon';
import { buildReconContext, RECON_INPUT_LIMITS, type ReconRun } from '../research/reconContext';

export async function legacyScanSummary(run: Omit<ReconRun, 'logs' | 'discoveries'>) {
  const [logs, discoveries] = await Promise.all([
    prisma.$queryRaw<ReconRun['logs']>`
      SELECT id, left(line, 16385) AS line, stream::text AS stream, "createdAt"
      FROM "ScanLog" WHERE "scanRunId" = ${run.id}
      ORDER BY "createdAt", id LIMIT ${RECON_INPUT_LIMITS.logs + 1}
    `,
    prisma.hostDiscovery.findMany({
      where: { scanRunId: run.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: RECON_INPUT_LIMITS.discoveries + 1,
      select: { id: true, host: true, source: true, state: true, createdAt: true },
    }),
  ]);

  const context = buildReconContext({
    programId: '', scopeId: '', targetId: run.targetId,
    generatedAt: (run.finishedAt ?? run.createdAt).toISOString(),
    runs: [{ ...run, logs: logs.slice(0, RECON_INPUT_LIMITS.logs), discoveries: discoveries.slice(0, RECON_INPUT_LIMITS.discoveries) }],
    inScope: () => false,
    activeSuggestionsAllowed: false,
  });
  const tools = new Map(context.sources.map(source => [source.id, source.tool]));
  const row = (kind: string, evidence: ReconEvidence, value: Record<string, unknown>) => ({
    kind, value, verification: evidence.confidence, scopeState: 'UNKNOWN',
    sources: evidence.sources.map(id => ({ tool: tools.get(id) })),
  });
  const artifacts = [
    ...context.assets.map(asset => row('hostname', asset, { hostname: asset.hostname || asset.ip, url: asset.url })),
    ...context.endpoints.map(endpoint => row('endpoint', endpoint, { url: endpoint.url, statusCode: endpoint.statusCode })),
    ...context.technologies.map(tech => row('technology', tech, { name: tech.name, hostname: tech.asset })),
    ...context.observations.map(item => row('observation', item, { name: item.description })),
  ];
  return {
    ...buildScanSummary(artifacts, artifacts.length),
    fromLegacyLogs: true,
    legacyTruncated: logs.length > RECON_INPUT_LIMITS.logs || discoveries.length > RECON_INPUT_LIMITS.discoveries || context.truncated,
  };
}
