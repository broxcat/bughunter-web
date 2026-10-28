import { constants } from 'node:fs';
import { open, lstat, rm, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { issueStopTicket, targetIdentity, targetWorkspaceId } from '@/lib/research/terminal';
import { workspacePath, ResearchError } from './research/workspace';
import { researchRootFor } from './research/sessions';
import { consoleRoot } from './research/consoleWorkspace';
import { readTerminalSigningKey } from './research/terminalKey';
import { requestScanCancellation, settleQueuedCancellations } from './queue/scanCancellation';
import { purgeScanJobs } from './queue/scanQueue';

async function safeRoot(root: string) {
  if (await realpath(root) !== resolve(root)) throw new ResearchError('Unsafe workspace root', 409);
}
async function revokeWorkspace(root: string, workspaceId: string) {
  const path = workspacePath(root, workspaceId);
  try {
    await safeRoot(root);
    const directory = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const marker = await open(`/proc/self/fd/${directory.fd}/.deleting`, constants.O_RDONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o440);
      await marker.close();
    } finally { await directory.close(); }
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
}
async function removeWorkspace(root: string, workspaceId: string) {
  try { await safeRoot(root); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
  const path = workspacePath(root, workspaceId);
  for (const entry of [path, join(root, `.tmp-${workspaceId}`), join(root, '.exports', `${workspaceId}.zip`), join(root, '.exports', `.tmp-${workspaceId}`)]) {
    // Never traverse an operator-replaced export directory.
    if (dirname(entry) !== root) {
      const parent = await lstat(dirname(entry)).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
      if (!parent) continue;
      if (!parent.isDirectory() || parent.isSymbolicLink()) throw new ResearchError('Unsafe workspace export', 409);
    }
    await rm(entry, { recursive: true, force: true });
  }
}
export async function deleteProgram(userId: string, programId: string) {
  targetIdentity.parse(programId);
  // Durable tombstone is committed before external cleanup. A retry resumes it.
  const exists = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "BountyProgram" WHERE id=${programId} AND "ownerId"=${userId} FOR UPDATE`;
    if (!rows.length) return false;
    await tx.bountyProgram.update({ where: { id: programId }, data: { deletingAt: new Date() } });
    return true;
  });
  if (!exists) return; // Idempotent; discloses no ownership information.
  await prisma.$transaction(async tx => {
    // One cleanup at a time across replicas; don't hold program/scan row locks
    // while waiting for workers to confirm cancellation.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${programId}, 0))`;
    const program = await tx.bountyProgram.findFirst({ where: { id: programId, ownerId: userId } });
    if (!program) return;
    const targets = await tx.target.findMany({ where: { programId }, select: { id: true, scopeId: true, userId: true } });
    if (targets.some(t => t.userId !== userId)) throw new ResearchError('Program ownership is inconsistent', 409);
    const ids = targets.map(t => t.id);
    const runs = await tx.scanRun.findMany({ where: { targetId: { in: ids } }, select: { id: true } });
    const sessions = await tx.researchSession.findMany({ where: { targetId: { in: ids } }, select: { workspaceId: true, targetId: true } });
    // Also recover a publication whose SQL transaction failed after filesystem
    // publication. Deterministic console paths belong only to this identity.
    for (const target of targets) {
      const workspaceId = targetWorkspaceId(target.id);
      if (sessions.some(s => s.workspaceId === workspaceId)) continue;
      for (const name of [workspaceId, `.tmp-${workspaceId}`]) {
        const stat = await lstat(join(consoleRoot(), name)).catch(e => { if(e.code !== 'ENOENT') throw e; return null; });
        if (stat) { sessions.push({ workspaceId, targetId: target.id }); break; }
      }
    }
    for (const run of runs) await requestScanCancellation(run.id, userId);
    await settleQueuedCancellations();
    for (const session of sessions) await revokeWorkspace(researchRootFor(session.workspaceId), session.workspaceId);
    if (sessions.length) {
      const privateKey = await readTerminalSigningKey();
      for (const session of sessions) {
        const response = await fetch(new URL('/control/stop', process.env.RESEARCH_TERMINAL_CONTROL_URL ?? 'http://research-console:7681'), {
          method: 'POST', headers: { Authorization: `Bearer ${issueStopTicket(session.targetId, session.workspaceId, privateKey)}` }, signal: AbortSignal.timeout(30000),
        });
        if (!response.ok || (await response.json()).stopped !== true) throw new ResearchError('Console cleanup unconfirmed; retry deletion', 503);
      }
    }
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
    for (const session of sessions) await removeWorkspace(researchRootFor(session.workspaceId), session.workspaceId);
    // Reports spanning other targets and OOB tokens shared with other findings
    // remain intact. Exclusive report content must not survive SET NULL FKs.
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
  }, { timeout: 60000, maxWait: 1000 });
}
