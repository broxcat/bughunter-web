import { auth } from '@/lib/auth';
import { foreignOrigin } from '@/lib/requestOrigin';
import { ensureAssetExecution } from '@/server/scopeAssets';
import { createScanRequest, ScanRequestQuotaExceeded } from '@/server/queue/scanRequest';
import { publishScanJob } from '@/server/queue/scanJobPublisher';
import { assetError } from '@/server/scopeAssets';
import { loadTargetExecution } from '@/server/execution';
import { loadScopeBrief } from '@/server/scopeMarkdown';
import { compactReconContext } from '@/server/research/reconContext';
import { prisma } from '@/lib/prisma';
import { assetHostAllowed } from '@/server/scopeAssets';
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const session = await auth(); if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id, assetId } = await params;
  try {
    const brief = await loadScopeBrief(session.user.id, id, assetId), asset = brief.assets[0];
    const discoveries = await prisma.hostDiscovery.findMany({ where: { scanRun: { scopeAssetId: assetId, target: { programId: id, userId: session.user.id } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100, select: { host: true, source: true, scanRunId: true, createdAt: true } });
    const targets = await prisma.target.findMany({ where: { programId: id, userId: session.user.id, active: true, host: { in: discoveries.map(d => d.host) } }, select: { id: true, host: true } });
    const hosts = [...new Map(discoveries.map(d => [d.host, { ...d, inScope: assetHostAllowed(asset, d.host, brief.program.outOfScope), targetId: targets.find(t => t.host === d.host)?.id }])).values()];
    return Response.json({ context: compactReconContext(brief.contexts.get(assetId)!), hosts, untrustedData: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return assetError(e); }
}
export async function POST(req: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const session = await auth(); if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { id, assetId } = await params;
  try {
    const { target } = await ensureAssetExecution(session.user.id, id, assetId);
    await loadTargetExecution(target.id, 'RECON');
    const run = await createScanRequest(session.user.id, { targetId: target.id, type: 'RECON', scopeAssetId: assetId }, null, true);
    const result = await publishScanJob(run.id);
    return Response.json({ ...run, ...result }, { status: result.dispatch === 'PUBLISHED' ? 201 : 202 });
  } catch (e) { return e instanceof ScanRequestQuotaExceeded ? Response.json({ error: e.message }, { status: 429 }) : assetError(e); }
}
