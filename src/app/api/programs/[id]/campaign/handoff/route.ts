import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = (await auth())?.user?.id;
  if (!ownerId) return new Response('Unauthorized', { status: 401 });
  const { id } = await params;
  const campaign = await prisma.targetCampaign.findFirst({
    where: { programId: id, program: { ownerId } }, select: { handoffRunId: true },
  });
  const handoff = campaign?.handoffRunId ? await prisma.targetReconRun.findFirst({
    where: { id: campaign.handoffRunId, programId: id, program: { ownerId } },
    select: { scopeMarkdown: true },
  }) : null;
  if (!handoff?.scopeMarkdown) return new Response('Research handoff not found', { status: 404 });
  return new Response(handoff.scopeMarkdown, { headers: {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': 'attachment; filename="research-handoff.md"',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  } });
}
