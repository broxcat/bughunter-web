import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import ReportEditor from '@/components/ReportEditor';
import { findingAvailableForReport } from '@/lib/findingLifecycle';
import { safeFindingText } from '@/server/findingPrivacy';

export default async function ReportPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ finding?: string }>;
}) {
  const { id } = await params;
  const userId = (await auth())?.user?.id;
  if (!userId) return null;
  const program = await prisma.bountyProgram.findFirst({ where: { id, ownerId: userId }, select: { id: true } });
  if (!program && !await prisma.target.findFirst({ where: { id, userId }, select: { id: true } })) notFound();
  const { finding: findingId } = await searchParams;
  const finding = typeof findingId === 'string' && findingId.length <= 150 ? await prisma.finding.findFirst({
    where: { id: findingId, target: { userId, ...(program ? { programId: id } : { id }) } },
    select: { id: true, title: true, severity: true, targetId: true, reviewStatus: true, gateStatus: true, reviewEvidence: true,
      lifecycle: true, lifecycleEvents: { where: { state: 'VALIDATED' }, take: 1, select: { id: true } } },
  }) : null;
  if (findingId && (!finding || !findingAvailableForReport(finding))) notFound();
  const initialFinding = finding ? { id: finding.id, targetId: finding.targetId, title: safeFindingText(finding.title), severity: finding.severity } : undefined;
  return <ReportEditor key={finding?.id ?? id} id={id} programMode={Boolean(program)} initialFinding={initialFinding} />;
}
