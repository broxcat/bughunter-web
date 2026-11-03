import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { prisma } from '@/lib/prisma';
import { targetIdentity, targetWorkspaceId, issueStopTicket } from '@/lib/research/terminal';
import { consoleRoot } from './consoleWorkspace';
import { readTerminalSigningKey } from './terminalKey';
import { ResearchError } from './workspace';
import { revokeWorkspace, removeWorkspace } from './workspaceCleanup';

/** Revocation survives failures; retry completes cleanup without touching Recon. */
export async function deleteResearchConsole(userId: string, targetId: string) {
  targetIdentity.parse(targetId);
  const target = await prisma.$transaction(async tx => {
    const owned = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Target" WHERE id=${targetId} AND "userId"=${userId} FOR UPDATE`;
    if (!owned.length) return null;
    return tx.target.update({ where: { id: targetId }, data: { consoleDeletingAt: new Date() }, select: { id: true } });
  });
  if (!target) return;
  // Serialize exclusive filesystem cleanup across replicas. No Target row lock
  // is held while waiting for providers, and the committed tombstone blocks open.
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`console-delete:${targetId}`},0))`;
    // A concurrent cleanup may already have finished. Do not remove a freshly
    // recreated workspace when this request was waiting for that cleanup.
    if (!await tx.target.count({ where: { id: targetId, userId, consoleDeletingAt: { not: null } } })) return;
    const workspaceId = targetWorkspaceId(targetId), root = consoleRoot();
    const session = await tx.researchSession.findUnique({ where: { consoleTargetId: targetId }, select: { id: true, workspaceId: true } });
    if (session && session.workspaceId !== workspaceId) throw new ResearchError('Console workspace identity mismatch', 409);
    const published = await lstat(join(root, workspaceId)).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
    if (session || published) {
      await revokeWorkspace(root, workspaceId);
      const key = await readTerminalSigningKey();
      const response = await fetch(new URL('/control/stop', process.env.RESEARCH_TERMINAL_CONTROL_URL ?? 'http://research-console:7681'), {
        method: 'POST', headers: { Authorization: `Bearer ${issueStopTicket(targetId, workspaceId, key)}` }, signal: AbortSignal.timeout(30000),
      });
      if (!response.ok || (await response.json()).stopped !== true) throw new ResearchError('Console cleanup unconfirmed; retry Delete', 503);
    }
    await removeWorkspace(root, workspaceId);
    await tx.$queryRaw`SELECT id FROM "Target" WHERE id=${targetId} AND "userId"=${userId} FOR UPDATE`;
    await tx.researchFindingPromotion.deleteMany({ where: { hypothesis: { session: { consoleTargetId: targetId, userId } } } });
    await tx.researchSession.deleteMany({ where: { consoleTargetId: targetId, userId } });
    await tx.target.updateMany({ where: { id: targetId, userId }, data: { consoleDeletingAt: null } });
  }, { timeout: 60000, maxWait: 1000 });
}
