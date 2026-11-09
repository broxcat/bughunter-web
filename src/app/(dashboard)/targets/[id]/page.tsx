
import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { platformLabel } from '@/lib/platformPresentation';
import { MISSING_HUNTER_UA, POLICY_REVIEW_ANCHOR } from '@/lib/programExecutionPolicy';
import { programPolicyBlocker, programPolicyInclude } from '@/server/programExecutionPolicy';
import ProgramWorkflow from '@/components/ProgramWorkflow';

export default async function TargetPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) return null;
  const program = await prisma.bountyProgram.findFirst({
    where: { id, ownerId: session.user.id },
    include: programPolicyInclude,
  });
  if (!program) {
    if (await prisma.target.findFirst({ where: { id, userId: session.user.id } })) redirect('/hosts/' + id);
    notFound();
  }
  const blocker = programPolicyBlocker(program);
  return <div className="space-y-5">
    <Link href="/targets" className="text-sm text-brand">← Targets</Link>
    <div className="flex flex-wrap items-center gap-3">
      <h1 className="text-2xl font-semibold">{program.companyName}</h1>
      <Link className="ml-auto text-brand underline" href={'/targets/' + program.id + '/settings'}>Target settings</Link>
    </div>
    {program.deletingAt && <p role="status">Target deletion is in progress. Retry Delete Target to finish cleanup.</p>}
    <p className="flex flex-wrap gap-3 text-sm text-muted">
      <span>{platformLabel(program.platform)}</span>
      {program.programUrl && <a className="underline" href={program.programUrl} target="_blank" rel="noopener noreferrer">Program ↗</a>}
    </p>
    {(await searchParams).saved === '1' && <p role="status">Target settings saved. Future operations use current policy; captured history is unchanged.</p>}
    {blocker && <p role="status">
      {blocker} <Link className="underline" href={blocker === MISSING_HUNTER_UA ? '/settings' : '/targets/' + id + '/settings#' + POLICY_REVIEW_ANCHOR}>
        {blocker === MISSING_HUNTER_UA ? 'Open Settings' : 'Review policy'}
      </Link>
    </p>}
    <ProgramWorkflow program={{ id, outOfScope: program.outOfScope, deletingAt: program.deletingAt?.toISOString() ?? null }} />
  </div>;
}
