import { prisma } from '@/lib/prisma';
import { targetIdentity } from '@/lib/research/terminal';
import { ResearchError } from './research/workspace';

/** Keep existing ScanRun/ResearchSession FKs and worker/PTY infrastructure.
 * This inactive context identity is not an asset and never enters /scopes. */
export async function ensureProgramContext(userId: string, programId: string) {
  targetIdentity.parse(programId);
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{id:string}[]>`SELECT id FROM "BountyProgram" WHERE id=${programId} AND "ownerId"=${userId} AND "deletingAt" IS NULL FOR UPDATE`;
    if (!rows.length) throw new ResearchError('Target unavailable', 404);
    const existing = await tx.target.findFirst({ where: { programId, contextOnly: true, userId } });
    if (existing) return existing;
    const scope = await tx.scope.create({ data: { userId, hostPattern: 'program.invalid', status: 'APPROVED' } });
    return tx.target.create({ data: { userId, programId, scopeId: scope.id, host: 'program.invalid', active: false, contextOnly: true } });
  });
}
