import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { resolve } from "node:path";
import { assertResearchTarget, researchAuthorizationMatches, researchTargetSelect, ResearchError } from "./workspace";

export const researchRoot = () => process.env.RESEARCH_WORKSPACE_ROOT ?? resolve("data/research/workspaces");
export const researchRootFor = (workspaceId: string) => workspaceId.startsWith("research_") ? process.env.RESEARCH_CONSOLE_ROOT ?? resolve("data/research/targets") : researchRoot();
export const ownedResearch = (userId: string) => ({ userId, target: { userId, OR: [{ program: null }, { program: { ownerId: userId } }] } });
// The same bounded metadata response is used for list/detail; no paths or secrets.
export const researchSessionSelect = {
  id: true, workspaceId: true, consoleTargetId: true, provider: true, targetId: true, targetHost: true, programName: true,
  authorizationSnapshot: true, reconScanRunId: true, researchPlanId: true, status: true, createdAt: true, updatedAt: true,
  scopeMarkdown: true, files: true, hypothesesSyncedAt: true, hypothesesSourceSha256: true,
} as const;

export async function createResearchSession(userId: string, targetId: string) {
  try {
    const { provisionResearch } = await import('./provisioning');
    return (await provisionResearch(userId, targetId, 'legacy')).session;
  } catch (error) {
    if (error instanceof ResearchError) throw error;
    logger.error({ operation: 'research-create', code: 'RESEARCH_EXPORT_FAILED' }, 'Research workspace creation failed');
    throw new ResearchError('Unable to create research workspace', 500);
  }
}

/** Server-side recovery of an identified CREATING legacy reservation. */
export async function resumeResearchSession(userId: string, sessionId: string) {
  const session = await prisma.researchSession.findFirst({ where: { id: sessionId, userId, consoleTargetId: null }, select: { targetId: true } });
  if (!session) throw new ResearchError('Research session not found', 404);
  const { provisionResearch } = await import('./provisioning');
  return (await provisionResearch(userId, session.targetId, 'legacy', sessionId)).session;
}

/** Display current policy drift without rewriting immutable exports. */
export async function researchPolicyState(targetId: string, userId: string, snapshot: unknown) {
  const target = await prisma.target.findUnique({ where: { id: targetId }, select: researchTargetSelect });
  try { if (!target) return "INACTIVE" as const; assertResearchTarget(target, userId); }
  catch { return "INACTIVE" as const; }
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return "LEGACY" as const;
  return researchAuthorizationMatches(snapshot, target) ? "CURRENT" as const : "CHANGED" as const;
}
