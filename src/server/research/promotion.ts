import { z } from "zod";
import type { Prisma } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { redactEvidenceText } from '@/lib/evidenceVault';
import { reproducibleResearchTests, savedResearchReview, type ResearchReviewInput } from '@/lib/research/humanReview';
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { suggestCwe } from "@/lib/cwe";
import { hypothesisV2Schema, researchBindingError, researchDataSchema, type ResearchData } from "@/lib/research/hypotheses";
import { HypothesisSyncError, hypothesisSnapshot } from "./hypotheses";
import { ownedResearch } from "./sessions";
import { assertResearchTarget, researchIsPassive, researchTargetSelect, researchAuthorizationMatches, exportText, type ResearchTarget } from "./workspace";
import { reconScopePolicy } from './reconPolicy';

export const promoteHypothesisSchema = z.strictObject({ expectedRevision: z.number().int().min(1).max(2147483647), acknowledgeHumanReview: z.literal(true) });
async function lockHypothesis(tx: Prisma.TransactionClient, sessionId: string, hypothesisId: string, userId: string) {
  // Same session lock as sync: an import cannot change the reviewed revision
  // during promotion. SQL uniqueness is the second idempotence boundary.
  await tx.$queryRaw`SELECT "id" FROM "ResearchSession" WHERE "id" = ${sessionId} AND "userId" = ${userId} FOR UPDATE`;
  const session = await tx.researchSession.findFirst({ where: { id: sessionId, ...ownedResearch(userId) } });
  if (!session) throw new HypothesisSyncError("NOT_FOUND", "Research session not found", 404);
  await tx.$queryRaw`SELECT "id" FROM "ResearchHypothesis" WHERE "id" = ${hypothesisId} AND "sessionId" = ${session.id} FOR UPDATE`;
  const h = await tx.researchHypothesis.findFirst({ where: { id: hypothesisId, sessionId }, include: { promotion: true } });
  if (!h) throw new HypothesisSyncError("NOT_FOUND", "Research hypothesis not found", 404);
  return { session, h };
}

async function checkDecisionScope(tx: Prisma.TransactionClient, session: { targetId: string; authorizationSnapshot: unknown }, userId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Target" WHERE "id" = ${session.targetId} FOR SHARE`;
  let target = await tx.target.findUnique({ where: { id: session.targetId }, select: researchTargetSelect });
  if (!target || target.userId !== userId || target.program?.ownerId !== userId || target.scope.userId !== userId) throw new HypothesisSyncError("NOT_FOUND", "Target not found", 404);
  await tx.$queryRaw`SELECT "id" FROM "Scope" WHERE "id" = ${target.scope.id} FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "BountyProgram" WHERE "id" = ${target.program.id} FOR SHARE`;
  const boundary = target.scopeAsset ?? target.discoveredFromAsset;
  if (boundary) await tx.$queryRaw`SELECT "id" FROM "ScopeAsset" WHERE "id" = ${boundary.id} FOR SHARE`;
  target = await tx.target.findUniqueOrThrow({ where: { id: session.targetId }, select: researchTargetSelect });
  try { assertResearchTarget(target, userId); } catch { throw new HypothesisSyncError("SCOPE_UNAVAILABLE", "Target authorization is no longer active", 409); }
  const snapshot = session.authorizationSnapshot as Record<string, unknown> | null;
  if (!snapshot) throw new HypothesisSyncError("LEGACY_AUTHORIZATION", "Legacy authorization snapshot: create a current Research Workspace before promotion", 409);
  if (!researchAuthorizationMatches(snapshot, target)) throw new HypothesisSyncError("POLICY_CHANGED", "Program or scope changed since export. Create a current workspace before promotion.", 409);
  return target;
}

function hasScopedReviewTest(proof: ResearchData, testId: string, target: ResearchTarget) {
  const test = reproducibleResearchTests(proof).find(item => item.id === testId);
  if (!test || researchIsPassive(target)) return false;
  const policy = reconScopePolicy(target);
  const observed = [...test.observations, ...(test.negativeControl.kind === 'PERFORMED' ? test.negativeControl.observations : [])];
  return Boolean(proof.location && policy.inScope(proof.location) &&
    test.observations.some(observation => observation.location && policy.inScope(observation.location)) &&
    observed.every(observation => !observation.location || policy.inScope(observation.location)));
}

export async function recordResearchReview(sessionId: string, hypothesisId: string, userId: string, input: ResearchReviewInput) {
  return prisma.$transaction(async tx => {
    const { session, h } = await lockHypothesis(tx, sessionId, hypothesisId, userId);
    if (!session.consoleTargetId || session.status !== 'READY') throw new HypothesisSyncError('SESSION_NOT_READY', 'Review requires a ready Research console', 409);
    if (h.revision !== input.expectedRevision) throw new HypothesisSyncError('REVISION_CHANGED', 'Hypothesis changed. Reload and review its current revision.', 409);
    const target = await checkDecisionScope(tx, session, userId);
    const proof = researchDataSchema.safeParse(h.researchData);
    if (!proof.success) throw new HypothesisSyncError('PROOF_REQUIRED', 'Sync a structured v2 hypothesis before reviewing it.', 409);
    if (input.verdict === 'SUPPORTED' && (h.status !== 'CONFIRMED' || !hasScopedReviewTest(proof.data, input.testId, target))) {
      throw new HypothesisSyncError('PROOF_REQUIRED', 'Select an in-scope reproduced test with direct evidence, impact and controls from this CONFIRMED revision.', 409);
    }
    const { expectedRevision: revision, ...decision } = input;
    const reason = redactEvidenceText(exportText(decision.reason));
    const payload = decision.verdict === 'SUPPORTED'
      ? { ...decision, reason, accessContext: redactEvidenceText(exportText(decision.accessContext)) }
      : { ...decision, reason };
    const saved = savedResearchReview.safeParse({ ...payload, reviewedAt: new Date().toISOString() });
    if (!saved.success) throw new HypothesisSyncError('INVALID_REVIEW', 'Enter a redacted review with an access context and rationale.', 400);
    const where = { hypothesisId_revision: { hypothesisId, revision } };
    const row = await tx.researchHypothesisRevision.findUnique({ where, select: { humanReview: true } });
    if (!row) throw new HypothesisSyncError('REVISION_CHANGED', 'The reviewed revision is unavailable.', 409);
    if (row.humanReview !== null) {
      const previous = savedResearchReview.safeParse(row.humanReview);
      if (previous.success && isDeepStrictEqual(previous.data, { ...saved.data, reviewedAt: previous.data.reviewedAt })) return previous.data;
      throw new HypothesisSyncError('ALREADY_REVIEWED', 'This revision already has a recorded decision. Sync new evidence to review a new revision.', 409);
    }
    if (h.promotion) throw new HypothesisSyncError('ALREADY_PROMOTED', 'Use Evidence Review on the existing Finding to record a changed decision.', 409);
    await tx.researchHypothesisRevision.update({ where, data: { humanReview: saved.data } });
    return saved.data;
  }, { timeout: 15000 });
}

export async function promoteHypothesis(sessionId: string, hypothesisId: string, userId: string, expectedRevision: number) {
  const result = await prisma.$transaction(async tx => {
    const { session, h } = await lockHypothesis(tx, sessionId, hypothesisId, userId);
    // Replays only return the existing object; they never modify its human review
    // or regenerate it from newer Research data (even after scope revocation).
    if (h.promotion) return { findingId: h.promotion.findingId, targetId: session.targetId, hypothesisRevision: h.promotion.hypothesisRevision, created: false };
    if (session.status !== "READY") throw new HypothesisSyncError("SESSION_NOT_READY", "Only a READY session can create a draft", 409);
    if (h.revision !== expectedRevision) throw new HypothesisSyncError("REVISION_CHANGED", "Hypothesis changed. Reload and review its current revision.", 409);
    if (h.status !== "CONFIRMED") throw new HypothesisSyncError("NOT_CONFIRMED", "Only a CONFIRMED research hypothesis can be submitted to human Finding review", 409);
    const target = await checkDecisionScope(tx, session, userId);
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
    let humanReview;
    if (session.consoleTargetId) {
      const revision = await tx.researchHypothesisRevision.findUnique({
        where: { hypothesisId_revision: { hypothesisId, revision: h.revision } },
        select: { humanReview: true },
      });
      const reviewed = savedResearchReview.safeParse(revision?.humanReview);
      const review = reviewed.success ? reviewed.data : null;
      if (review?.verdict !== 'SUPPORTED' || !hasScopedReviewTest(proof, review.testId, target)) {
        throw new HypothesisSyncError('REVIEW_REQUIRED', 'Record a supported independent review of this exact revision before creating a Finding draft.', 409);
      }
      humanReview = review;
    }
    const evidence = {
      source: "RESEARCH_HUMAN_PROMOTION", sessionId, hypothesisId, externalId: h.externalId,
      planItemId: h.planItemId,
      revision: h.revision, workspaceId: session.workspaceId, targetHost: target.host,
      ...(humanReview ? { humanReview } : {}),
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
    const vaultLinks=await tx.evidenceHypothesis.findMany({where:{hypothesisId:h.id,revision:h.revision},select:{evidenceId:true,role:true}});
    if(vaultLinks.length)await tx.evidenceFinding.createMany({data:vaultLinks.map(link=>({evidenceId:link.evidenceId,findingId:finding.id,findingReferenceId:finding.id,role:link.role})),skipDuplicates:true});
    await tx.researchFindingPromotion.create({ data: { hypothesisId: h.id, findingId: finding.id, userId, hypothesisRevision: h.revision, snapshot: safe } });
    return { findingId: finding.id, targetId: target.id, hypothesisRevision: h.revision, created: true };
  }, { timeout: 15000 });
  logger.info({ operation: "research-promotion", code: result.created ? "DRAFT_CREATED" : "DRAFT_ALREADY_EXISTS", sessionId, hypothesisId, findingId: result.findingId }, "Research human promotion");
  return result;
}
