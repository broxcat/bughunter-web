import { prisma } from '@/lib/prisma';
import { ResearchError } from './research/workspace';

/** Keep existing ScanRun/ResearchSession FKs. This inactive context identity
 * is not an asset and never enters /scopes. */
export async function ensureProgramContext(userId: string, programId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,149}$/.test(programId)) throw new ResearchError('Invalid program identity', 400);
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{id:string}[]>`SELECT id FROM "BountyProgram" WHERE id=${programId} AND "ownerId"=${userId} AND "deletingAt" IS NULL FOR UPDATE`;
    if (!rows.length) throw new ResearchError('Target unavailable', 404);
    const existing = await tx.target.findFirst({ where: { programId, contextOnly: true, userId } });
    if (existing) return existing;
    const scope = await tx.scope.create({ data: { userId, hostPattern: 'program.invalid', status: 'APPROVED' } });
    return tx.target.create({ data: { userId, programId, scopeId: scope.id, host: 'program.invalid', active: false, contextOnly: true } });
  });
}
