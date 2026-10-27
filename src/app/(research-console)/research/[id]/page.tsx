import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect, notFound } from 'next/navigation';
import { assertResearchTarget, researchTargetSelect, ResearchError } from '@/server/research/workspace';
import { ownedResearch } from '@/server/research/sessions';
import ResearchTerminal from '@/components/ResearchTerminal';
export default async function ConsolePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth(); if (!session?.user?.id) redirect('/login');
  const { id } = await params;
  const target = await prisma.target.findFirst({ where: { id, userId: session.user.id }, select: researchTargetSelect });
  if (!target) {
    // Historical session bookmarks remain readable; a session ID never names a terminal.
    if (await prisma.researchSession.findFirst({ where: { id, ...ownedResearch(session.user.id) }, select: { id: true } })) redirect(`/research/history/${id}`);
    notFound();
  }
  try { assertResearchTarget(target, session.user.id); }
  catch (error) { if (error instanceof ResearchError && error.status === 404) notFound(); return <p role="alert" className="p-6">Research unavailable: current scope authorization is required. Stop active testing.</p>; }
  return <ResearchTerminal targetId={target.id} company={target.program!.companyName} host={target.host} requiredUserAgent={target.program!.requiredUserAgent} />;
}
