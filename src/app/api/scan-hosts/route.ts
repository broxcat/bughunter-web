import { withApiBoundary } from '@/lib/apiBoundary';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { scanRejection } from '@/server/execution';
import { programPolicyInclude, resolveProgramPolicy } from '@/server/programExecutionPolicy';

 async function handleGET() {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const [programs, targets] = await prisma.$transaction([
    prisma.bountyProgram.findMany({ where: { ownerId: userId }, orderBy: [{ companyName: 'asc' }, { id: 'asc' }], include: programPolicyInclude }),
    prisma.target.findMany({
      where: { userId, active: true, program: { ownerId: userId } },
      orderBy: [{ host: 'asc' }, { id: 'asc' }],
      include: { scope: true, scanRuns: { where: { type: 'RECON', status: 'COMPLETED' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, createdAt: true } } },
    }),
  ], { isolationLevel: 'RepeatableRead' });
  const byProgram = Map.groupBy(targets, target => target.programId);
  return Response.json(programs.map(program => {
    const { id, companyName, qualifying, nonQualifying, scopeRules, deletingAt } = program;
    let requiredUserAgent = '';
    try { requiredUserAgent = resolveProgramPolicy(program).userAgent; } catch { /* An invalid policy cannot admit any hosts. */ }
    return {
      id, companyName, qualifying, nonQualifying, scopeRules, deletingAt, requiredUserAgent,
      hosts: (byProgram.get(id) ?? []).filter(target => !scanRejection({ ...target, program }, 'RECON'))
        .map(target => ({ id: target.id, host: target.host, latestRecon: target.scanRuns[0] ?? null })),
    };
  }));
}

export const GET = withApiBoundary(handleGET, []);
