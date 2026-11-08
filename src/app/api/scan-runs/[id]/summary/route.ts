import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { artifactKinds } from '@/lib/reconArtifacts';
import { buildScanSummary } from '@/lib/scanSummary';
import { legacyScanSummary } from '@/server/recon/legacyScanSummary';

const PER_KIND_LIMIT = 100;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new Response(null, { status: 401 });

  const { id } = await params;
  const run = await prisma.scanRun.findFirst({
    where: { id, type: 'RECON', target: { userId: session.user.id } },
    select: { id: true, _count: { select: { artifacts: true } } },
  });
  if (!run) return new Response(null, { status: 404 });

  if (!run._count.artifacts) {
    const legacy = await prisma.scanRun.findFirst({
      where: { id, type: 'RECON', target: { userId: session.user.id } },
      select: {
        id: true, targetId: true, target: { select: { host: true } },
        status: true, outcome: true, createdAt: true, startedAt: true, finishedAt: true, reconCorpus: true,
      },
    });
    if (!legacy) return new Response(null, { status: 404 });
    return Response.json(await legacyScanSummary(legacy), { headers: { 'Cache-Control': 'private, no-store' } });
  }

  const buckets = await Promise.all(artifactKinds.map(kind => prisma.reconArtifact.findMany({
    where: { scanRunId: run.id, kind },
    select: { kind: true, value: true, scopeState: true, verification: true, sources: true },
    orderBy: [{ scopeState: 'asc' }, { verification: 'desc' }, { canonicalKey: 'asc' }],
    take: PER_KIND_LIMIT,
  })));

  return Response.json(buildScanSummary(buckets.flat(), run._count.artifacts), {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
