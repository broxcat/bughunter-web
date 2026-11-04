import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { suggestCwe } from "@/lib/cwe";
import { hypothesisV2Schema, researchBindingError, researchDataSchema } from "@/lib/research/hypotheses";
import { HypothesisSyncError, hypothesisSnapshot } from "./hypotheses";
import { ownedResearch } from "./sessions";
import { assertResearchTarget, researchTargetSelect, researchAuthorizationMatches, exportText } from "./workspace";

export const promoteHypothesisSchema = z.strictObject({ expectedRevision: z.number().int().min(1).max(2147483647), acknowledgeHumanReview: z.literal(true) });
export async function promoteHypothesis(sessionId: string, hypothesisId: string, userId: string, expectedRevision: number) {
  const result = await prisma.$transaction(async tx => {
    // Same session lock as sync: an import cannot change the reviewed revision
    // during promotion. SQL uniqueness is the second idempotence boundary.
    await tx.$queryRaw`SELECT "id" FROM "ResearchSession" WHERE "id" = ${sessionId} AND "userId" = ${userId} FOR UPDATE`;
    const session = await tx.researchSession.findFirst({ where: { id: sessionId, ...ownedResearch(userId) } });
    if (!session) throw new HypothesisSyncError("NOT_FOUND", "Research session not found", 404);
    await tx.$queryRaw`SELECT "id" FROM "ResearchHypothesis" WHERE "id" = ${hypothesisId} AND "sessionId" = ${session.id} FOR UPDATE`;
    const h = await tx.researchHypothesis.findFirst({ where: { id: hypothesisId, sessionId }, include: { promotion: true } });
    if (!h) throw new HypothesisSyncError("NOT_FOUND", "Research hypothesis not found", 404);
    // Replays only return the existing object; they never modify its human review
    // or regenerate it from newer Research data (even after scope revocation).
    if (h.promotion) return { findingId: h.promotion.findingId, targetId: session.targetId, hypothesisRevision: h.promotion.hypothesisRevision, created: false };
    if (session.status !== "READY") throw new HypothesisSyncError("SESSION_NOT_READY", "Only a READY session can create a draft", 409);
    if (h.revision !== expectedRevision) throw new HypothesisSyncError("REVISION_CHANGED", "Hypothesis changed. Reload and review its current revision.", 409);
    if (h.status !== "CONFIRMED") throw new HypothesisSyncError("NOT_CONFIRMED", "Only a CONFIRMED research hypothesis can be submitted to human Finding review", 409);
    await tx.$queryRaw`SELECT "id" FROM "Target" WHERE "id" = ${session.targetId} FOR SHARE`;
    let target = await tx.target.findUnique({ where: { id: session.targetId }, select: researchTargetSelect });
    if (!target || target.userId !== userId || target.program?.ownerId !== userId || target.scope.userId !== userId) throw new HypothesisSyncError("NOT_FOUND", "Target not found", 404);
    await tx.$queryRaw`SELECT "id" FROM "Scope" WHERE "id" = ${target.scope.id} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "BountyProgram" WHERE "id" = ${target.program.id} FOR SHARE`;
    target = await tx.target.findUniqueOrThrow({ where: { id: session.targetId }, select: researchTargetSelect });
    try { assertResearchTarget(target, userId); } catch { throw new HypothesisSyncError("SCOPE_UNAVAILABLE", "Target authorization is no longer active", 409); }
    const snapshot = session.authorizationSnapshot as Record<string, unknown> | null;
    if (!snapshot) throw new HypothesisSyncError("LEGACY_AUTHORIZATION", "Legacy authorization snapshot: create a current Research Workspace before promotion", 409);
    if (!researchAuthorizationMatches(snapshot, target)) throw new HypothesisSyncError("POLICY_CHANGED", "Program or scope changed since export. Create a current workspace before promotion.", 409);
    const candidate = hypothesisV2Schema.safeParse({
      planItemId:h.planItemId,
      externalId: h.externalId, title: h.title, status: h.status, hypothesis: h.hypothesis,
      evidenceFor: h.evidenceFor, evidenceAgainst: h.evidenceAgainst, nextTest: h.nextTest,
      expectedSignal: h.expectedSignal, falsificationCondition: h.falsificationCondition,
      confidence: h.confidence, tags: h.tags, notes: h.notes ?? undefined,
      blockedReason: h.blockedReason ?? undefined, ...((h.researchData as object | null) ?? {}),
    });
    if (!candidate.success) throw new HypothesisSyncError("PROOF_REQUIRED", "Legacy or incomplete proof: import a complete v2 hypothesis with reproducibility and controls first", 409);
    if (researchBindingError(candidate.data, { id: target.id, host: target.host, scheme: target.scheme ?? "https" })) throw new HypothesisSyncError("SCOPE_MISMATCH", "Research proof does not belong to this target", 409);
    const safe = hypothesisSnapshot(candidate.data), proof = researchDataSchema.parse(safe.researchData);
    const evidence = {
      source: "RESEARCH_HUMAN_PROMOTION", sessionId, hypothesisId, externalId: h.externalId,
      planItemId: h.planItemId,
      revision: h.revision, workspaceId: session.workspaceId, targetHost: target.host,
      evidenceFor: safe.evidenceFor, evidenceAgainst: safe.evidenceAgainst,
      observations: proof.initialObservations, tests: proof.tests,
      controls: proof.tests.map(t => t.negativeControl.kind === "PERFORMED" ? t.negativeControl.significance : t.negativeControl.reason),
      conclusion: proof.conclusion, researchConfirmationIsNotFindingReview: true,
    };
    const finding = await tx.finding.create({ data: {
      targetId: target.id, title: safe.title, vulnClass: proof.suspectedVulnClass,
      cwe: suggestCwe(proof.suspectedVulnClass ?? undefined) ?? undefined,
      location: proof.location, severity: "INFO", confidence: "CANDIDATE",
      description: exportText(`${safe.hypothesis}\n\nReasoning:\n${proof.reasoning}\n\nSuspected impact (not verified severity):\n${proof.suspectedImpact}\n\nResearch ${h.externalId}, revision ${h.revision}. Human Evidence Review is still required.`),
      evidence: JSON.stringify(evidence), reviewStatus: "CANDIDATE", gateStatus: "UNVALIDATED",
    } });
    await tx.researchFindingPromotion.create({ data: { hypothesisId: h.id, findingId: finding.id, userId, hypothesisRevision: h.revision, snapshot: safe } });
    return { findingId: finding.id, targetId: target.id, hypothesisRevision: h.revision, created: true };
  }, { timeout: 15000 });
  logger.info({ operation: "research-promotion", code: result.created ? "DRAFT_CREATED" : "DRAFT_ALREADY_EXISTS", sessionId, hypothesisId, findingId: result.findingId }, "Research human promotion");
  return result;
}
