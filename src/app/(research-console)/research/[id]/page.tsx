import Link from 'next/link';
import {providerSelection} from '@/lib/research/provider';
import ResearchKeyboardBoundary from '@/components/ResearchKeyboardBoundary';
import ResearchCoverage from '@/components/ResearchCoverage';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect, notFound } from 'next/navigation';
import { assertResearchTarget, researchIsPassive, researchTargetSelect, ResearchError } from '@/server/research/workspace';
import { ownedResearch } from '@/server/research/sessions';
import ResearchTerminal from '@/components/ResearchTerminal';
import ResearchPlan from '@/components/ResearchPlan';
export default async function ConsolePage({ params,searchParams }: { params: Promise<{ id: string }>;searchParams:Promise<{engine?:string;profile?:string}> }) {
  const session = await auth(); if (!session?.user?.id) redirect('/login');
  const { id } = await params;
  const target = await prisma.target.findFirst({ where: { id, userId: session.user.id }, select: researchTargetSelect });
  if (!target) {
    // Historical session bookmarks remain readable; a session ID never names a terminal.
    if (await prisma.researchSession.findFirst({ where: { id, ...ownedResearch(session.user.id) }, select: { id: true } })) redirect(`/research/history/${id}`);
    notFound();
  }
  try { assertResearchTarget(target, session.user.id); }
  catch (error) { if (error instanceof ResearchError && error.status === 404) notFound(); return <p role="alert" className="p-6">Research unavailable: current scope authorization is required. Stop active testing. <Link href="/research" className="underline">Return to Research</Link>.</p>; }
  const selection=await searchParams;
  const launch=selection.engine||selection.profile?providerSelection.safeParse({provider:selection.engine,profile:selection.profile}):undefined;
  if(launch&&!launch.success)return <p role="alert" className="p-6">Unsupported engine or launch profile. <Link href="/research" className="underline">Return to Research</Link> and choose a supported profile.</p>;
  const researchSession = await prisma.researchSession.findFirst({
    where: { consoleTargetId: target.id, targetId: target.id, status: 'READY', ...ownedResearch(session.user.id) },
    select: { id: true },
  });
  return <div className="flex h-dvh flex-col"><ResearchPlan key={target.id} targetId={target.id} enableWorkflow={!researchIsPassive(target)}/><ResearchCoverage key={target.id+':coverage'} targetId={target.id}/><ResearchKeyboardBoundary><ResearchTerminal key={target.id} initialSessionId={researchSession?.id} initialSelection={launch?.success?launch.data:undefined} targetId={target.id} company={target.program!.companyName} host={target.host} requiredUserAgent={target.program!.requiredUserAgent} /></ResearchKeyboardBoundary></div>;
}
