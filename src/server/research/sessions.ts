import { prisma } from '@/lib/prisma';
import { assertResearchTarget, researchAuthorizationMatches, researchAuthorizationSnapshot, researchTargetSelect, ResearchError } from './workspace';

export const ownedResearch = (userId: string) => ({
  userId,
  target: { userId, OR: [{ program: null }, { program: { ownerId: userId } }] },
});

export const researchSessionSelect = {
  id: true,
  activeTargetId: true,
  targetId: true,
  targetHost: true,
  programName: true,
  authorizationSnapshot: true,
  reconScanRunId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  scopeMarkdown: true,
} as const;

/** Create or refresh the database-only Research context for one authorized Target. */
export async function createResearchSession(userId: string, targetId: string) {
  const target = await prisma.target.findFirst({ where: { id: targetId, userId, program: { ownerId: userId } }, select: researchTargetSelect });
  if (!target) throw new ResearchError('Target not found', 404);
  assertResearchTarget(target, userId);
  const recon = await prisma.scanRun.findFirst({ where: { targetId, type: 'RECON', status: 'COMPLETED' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } });
  return prisma.researchSession.upsert({
    where: { activeTargetId: targetId },
    create: { userId, targetId, activeTargetId: targetId, reconScanRunId: recon?.id, status: 'READY', targetHost: target.host, programName: target.program!.companyName, scopeMarkdown: '', authorizationSnapshot: researchAuthorizationSnapshot(target) },
    update: { reconScanRunId: recon?.id, status: 'READY', targetHost: target.host, programName: target.program!.companyName, authorizationSnapshot: researchAuthorizationSnapshot(target) },
    select: researchSessionSelect,
  });
}

export async function researchPolicyState(targetId: string, userId: string, snapshot: unknown) {
  const target = await prisma.target.findUnique({ where: { id: targetId }, select: researchTargetSelect });
  try {
    if (!target) return 'INACTIVE' as const;
    assertResearchTarget(target, userId);
  } catch {
    return 'INACTIVE' as const;
  }
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return 'LEGACY' as const;
  return researchAuthorizationMatches(snapshot, target) ? 'CURRENT' as const : 'CHANGED' as const;
}
