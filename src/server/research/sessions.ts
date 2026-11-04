import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { resolve, join } from "node:path";
import { rm } from "node:fs/promises";
import { assertResearchTarget, researchAuthorizationSnapshot, researchAuthorizationMatches, createResearchBundle, newWorkspaceId, researchTargetSelect, ResearchError, workspacePath, writeResearchWorkspace } from "./workspace";
import { captureProgramAssessment } from '@/server/assessment';
import { captureResearchPlanForTarget } from './plans';
import { reconJson } from './reconContext';

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
  const workspaceId = newWorkspaceId(), root = researchRoot();
  let sessionId: string | undefined, published = false;
  try {
    // Serialize the durable per-user creation quota, including across web replicas.
    // Lock policy rows through publication so a concurrent revocation/exclusion
    // cannot silently publish an export under a policy that was already revoked.
    return await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "Target" WHERE "id" = ${targetId} AND "userId" = ${userId} FOR SHARE`;
      const target = await tx.target.findFirst({ where: { id: targetId, userId, program: { ownerId: userId } }, select: researchTargetSelect });
      if (!target) throw new ResearchError("Target not found", 404);
      await tx.$queryRaw`SELECT "id" FROM "Scope" WHERE "id" = ${target.scope.id} FOR SHARE`;
      await tx.$queryRaw`SELECT "id" FROM "BountyProgram" WHERE "id" = ${target.program!.id} FOR SHARE`;
      const current = await tx.target.findFirstOrThrow({ where: { id: targetId }, select: researchTargetSelect });
      assertResearchTarget(current, userId);
      if (current.scopeAsset && ['URL', 'WILDCARD_DOMAIN'].includes(current.scopeAsset.format)) throw new ResearchError('Use the persistent asset Research console for URL/path or wildcard scope. Historical ZIP workspaces remain unchanged.');
      if (await tx.researchSession.count({ where: { userId, createdAt: { gt: new Date(Date.now() - 3600_000) } } }) >= 20) throw new ResearchError("Research workspace quota reached (20 per hour)", 429);
      let recon = await tx.scanRun.findFirst({ where: { targetId, type: "RECON", status: "COMPLETED", OR: [{reconCorpus: { not: Prisma.DbNull }},{artifacts:{some:{}}},{surfaceObservations:{some:{}}}] }, orderBy: [{createdAt:'desc'},{id:'desc'}], select: { id: true, reconCorpus: true } });
      const findings = await tx.finding.findMany({ where: { targetId }, orderBy: { createdAt: "asc" }, take: 1000, select: { id: true, title: true, severity: true, vulnClass: true, reviewStatus: true, location: true } });
      const assessment = await captureProgramAssessment(tx, current.program!.id);
      const plan = await captureResearchPlanForTarget(tx,userId,targetId,{scanRunId:recon?.id});
      if(plan&&plan.selectedScanRunId!==recon?.id)recon=await tx.scanRun.findUnique({where:{id:plan.selectedScanRunId},select:{id:true,reconCorpus:true}});
      const session = await tx.researchSession.create({ data: { userId, targetId, workspaceId, authorizationSnapshot: { ...researchAuthorizationSnapshot(current), ...assessment }, targetHost: current.host, programName: current.program!.companyName, scopeMarkdown: "", reconScanRunId: recon?.id,researchPlanId:plan?.id } });
      sessionId = session.id;
      const bundle = createResearchBundle(current, recon, findings, session,false,plan?{id:plan.id,contentSha256:plan.contentSha256,jsonText:reconJson(plan.plan),markdownText:plan.markdown}:undefined);
      const result = await writeResearchWorkspace(root, workspaceId, bundle);
      published = true;
      return tx.researchSession.update({ where: { id: session.id }, data: { status: "READY", scopeMarkdown: bundle["scope.md"], ...result }, select: researchSessionSelect });
    }, { timeout: 15000 });
  } catch (error) {
    if (published) {
      await rm(workspacePath(root, workspaceId), { force: true, recursive: true }).catch(() => {});
      await rm(join(root, '.exports', `${workspaceId}.zip`), { force: true }).catch(() => {});
    }
    if (sessionId) {
      // Transaction rollback removes CREATING. Persist a safe failure record, with
      // no exception text, scope inputs, credentials or filesystem paths.
      await prisma.researchSession.create({ data: { id: sessionId, userId, targetId, workspaceId, targetHost: "Unavailable", programName: "Unavailable", scopeMarkdown: "", status: "FAILED" } }).catch(() => {});
    }
    if (error instanceof ResearchError) throw error;
    logger.error({ operation: "research-create", code: "RESEARCH_EXPORT_FAILED" }, "Research workspace creation failed");
    throw new ResearchError("Unable to create research workspace", 500);
  }
}

/** Display current policy drift without rewriting immutable exports. */
export async function researchPolicyState(targetId: string, userId: string, snapshot: unknown) {
  const target = await prisma.target.findUnique({ where: { id: targetId }, select: researchTargetSelect });
  try { if (!target) return "INACTIVE" as const; assertResearchTarget(target, userId); }
  catch { return "INACTIVE" as const; }
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return "LEGACY" as const;
  return researchAuthorizationMatches(snapshot, target) ? "CURRENT" as const : "CHANGED" as const;
}
