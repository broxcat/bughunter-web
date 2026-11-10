import { prisma } from '@/lib/prisma';
import { paginationBounds, type PageRequest } from '@/lib/pagination';
import { ResearchError } from '../research/workspace';

/** History is read-only. Count, clamp and rows share one owned DB snapshot. */
export function reconRunHistory(ownerId: string, programId: string, input: PageRequest, unpaged = false) {
  return prisma.$transaction(async tx => {
    const program = await tx.bountyProgram.findFirst({ where: { id: programId, ownerId }, select: { id: true, companyName: true, deletingAt: true } });
    if (!program) throw new ResearchError('Target not found', 404);
    const where = { programId, program: { ownerId } };
    const bounds = paginationBounds(input, await tx.targetReconRun.count({ where }));
    const items = await tx.targetReconRun.findMany({
      where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...(unpaged ? {} : { skip: bounds.skip, take: bounds.pageSize }),
      select: { id: true, createdAt: true, status: true, outcome: true, _count: { select: { scans: true } } },
    });
    return { ...bounds, program, items };
  }, { isolationLevel: 'RepeatableRead' });
}

/** Cheap heartbeat for exactly this historical run, never the latest instead. */
export async function reconRunStatus(ownerId: string, programId: string, runId: string) {
  const run = await prisma.targetReconRun.findFirst({
    where: { id: runId, programId, program: { ownerId } }, select: { id: true, status: true },
  });
  if (!run) throw new ResearchError('Recon run not found', 404);
  return run;
}
