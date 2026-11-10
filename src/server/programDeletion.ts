import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { targetIdentity } from '@/lib/research/identity';

/** Deletion owns SQL only. Workers observe vanished runs and the collector owns
 * external resources, including consoles that are currently unreachable. */
export async function deleteProgram(userId: string, programId: string) {
  targetIdentity.parse(programId);
  // Request cancellation without waiting for worker acknowledgement. Failure to
  // request it cannot veto deletion; heartbeat checks also detect missing rows.
  await prisma.scanRun.updateMany({ where: {
    target: { programId, program: { ownerId: userId } },
    status: { in: ['QUEUED', 'RUNNING'] }, cancelRequestedAt: null,
  }, data: { cancelRequestedAt: new Date() } }).catch(() => {
    logger.warn({ programId }, 'Scan cancellation request unavailable during deletion');
  });
  await prisma.$transaction(async tx => {
    const present = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "BountyProgram" WHERE id=${programId} AND "ownerId"=${userId} FOR UPDATE`;
    if (!present.length) return;
    // Keep multi-Target reports. Cascading findings remove only their own items;
    // the report's optional direct Target reference is SET NULL by PostgreSQL.
    await tx.report.deleteMany({ where: {
      userId,
      OR: [{ target: { programId } }, { items: { some: { finding: { target: { programId } } } } }],
      NOT: { items: { some: { finding: { target: { OR: [{ programId: null }, { programId: { not: programId } }] } } } } },
    } });
    await tx.bountyProgram.delete({ where: { id: programId } });
    logger.info({ operation: 'program-delete', programId, userId }, 'Target deleted; external cleanup deferred');
  }, { timeout: 30000 });
}
