import { prisma } from "@/lib/prisma";
import { resolve } from "node:path";
import { assertResearchTarget, researchAuthorizationMatches, researchTargetSelect } from "./workspace";

export const researchRoot = () => process.env.RESEARCH_WORKSPACE_ROOT ?? resolve("data/research/workspaces");
export const researchRootFor = (workspaceId: string) => workspaceId.startsWith("research_") ? process.env.RESEARCH_CONSOLE_ROOT ?? resolve("data/research/targets") : researchRoot();
export const ownedResearch = (userId: string) => ({ userId, target: { userId, OR: [{ program: null }, { program: { ownerId: userId } }] } });
// The same bounded metadata response is used for list/detail; no paths or secrets.
export const researchSessionSelect = {
  id: true, workspaceId: true, consoleTargetId: true, provider: true, targetId: true, targetHost: true, programName: true,
  authorizationSnapshot: true, reconScanRunId: true, researchPlanId: true, status: true, createdAt: true, updatedAt: true,
  scopeMarkdown: true, files: true, hypothesesSyncedAt: true, hypothesesSourceSha256: true,
} as const;

/** Display current policy drift without rewriting immutable exports. */
export async function researchPolicyState(targetId: string, userId: string, snapshot: unknown) {
  const target = await prisma.target.findUnique({ where: { id: targetId }, select: researchTargetSelect });
  try { if (!target) return "INACTIVE" as const; assertResearchTarget(target, userId); }
  catch { return "INACTIVE" as const; }
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return "LEGACY" as const;
  return researchAuthorizationMatches(snapshot, target) ? "CURRENT" as const : "CHANGED" as const;
}
