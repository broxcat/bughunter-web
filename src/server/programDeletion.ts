import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { ResearchError } from './research/workspace';
import { requestScanCancellation, settleQueuedCancellations } from './queue/scanCancellation';
import { purgeScanJobs } from './queue/scanQueue';

export async function deleteProgram(userId: string, programId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,149}$/.test(programId)) throw new ResearchError('Invalid program identity', 400);
  // Durable tombstone is committed before external cleanup. A retry resumes it.
  const exists = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "BountyProgram" WHERE id=${programId} AND "ownerId"=${userId} FOR UPDATE`;
    if (!rows.length) return false;
    await tx.bountyProgram.update({ where: { id: programId }, data: { deletingAt: new Date() } });
    return true;
  });
  if (!exists) return; // Idempotent; discloses no ownership information.
  // External cleanup uses the committed tombstone; do not hold a transaction
  // open across potentially slow provider shutdowns. Every step is idempotent.
  const tx=prisma;
    const program = await tx.bountyProgram.findFirst({ where: { id: programId, ownerId: userId } });
    if (!program) return;
    const targets = await tx.target.findMany({ where: { programId }, select: { id: true, scopeId: true, userId: true } });
    if (targets.some(t => t.userId !== userId)) throw new ResearchError('Program ownership is inconsistent', 409);
    const ids = targets.map(t => t.id);
    const runs = await tx.scanRun.findMany({ where: { targetId: { in: ids } }, select: { id: true } });
    await prisma.targetReconRun.updateMany({where:{programId,status:{in:['QUEUED','RUNNING']}},data:{cancelRequestedAt:new Date()}});
    await prisma.reconSummary.updateMany({where:{programId,status:{in:['PENDING','RUNNING']}},data:{status:'CANCELLED'}});
    for (const run of runs) await requestScanCancellation(run.id, userId);
    await settleQueuedCancellations();
    const deadline = Date.now() + 15000;
    while (true) {
      await settleQueuedCancellations();
      const pending = await prisma.scanRun.count({ where: { targetId: { in: ids }, OR: [{ status: { in: ['QUEUED', 'RUNNING'] } }, { executionAttempts: { some: { OR: [{ state: 'RUNNING' }, { state:'INTERRUPTED',cleanupConfirmedAt:null }, { reason: 'CLEANUP_UNCONFIRMED', cleanupConfirmedAt:null }] } } }] } });
      if (!pending) break;
      if (Date.now() >= deadline) throw new ResearchError('Scan cleanup unconfirmed; retry deletion after the worker stops', 503);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    // Redis job payloads/history also belong exclusively to these scans.
    await purgeScanJobs(runs.map(r => r.id));
    // Reports spanning other targets and OOB tokens shared with other findings
    // remain intact. Exclusive report content must not survive SET NULL FKs.
    await prisma.$transaction(async tx=>{
    const present=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "BountyProgram" WHERE id=${programId} AND "ownerId"=${userId} FOR UPDATE`;if(!present.length)return;
    const ownedFinding = { targetId: { in: ids } };
    const tokens = await tx.finding.findMany({ where: { ...ownedFinding, oobToken: { not: null } }, select: { oobToken: true } });
    await tx.report.deleteMany({ where: { userId, OR: [{ targetId: { in: ids } }, { items: { some: { finding: ownedFinding } } }], NOT: { items: { some: { finding: { targetId: { notIn: ids } } } } } } });
    await tx.researchFindingPromotion.deleteMany({ where: { OR: [{ finding: ownedFinding }, { hypothesis: { session: { targetId: { in: ids } } } }] } });
    await tx.researchSession.deleteMany({ where: { targetId: { in: ids } } });
    await tx.target.deleteMany({ where: { id: { in: ids } } });
    for (const token of new Set(tokens.map(t => t.oobToken!))) if (!await tx.finding.count({ where: { oobToken: token } })) await tx.oobHit.deleteMany({ where: { token } });
    await tx.scope.deleteMany({ where: { id: { in: targets.map(t => t.scopeId) }, userId, targets: { none: {} } } });
    await tx.bountyProgram.delete({ where: { id: programId } });
    logger.info({ operation: 'program-delete', programId, userId }, 'Target resources removed after confirmed cleanup');
  }, { timeout: 15000 });
}
