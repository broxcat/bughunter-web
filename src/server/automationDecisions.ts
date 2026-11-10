import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { LEGACY_LIMITS, storedExecutionPolicySchema } from '@/lib/programExecutionPolicy';
import { resolveProgramPolicy, currentPolicySelection } from './programExecutionPolicy';
import { campaignAfterReview } from './campaignOrchestrator';
import { lockOwnedProgram } from './scopeAssets';
import { ResearchError } from './research/workspace';

/** Owner decisions are append-only policy data, scoped to one displayed phrase. */
export async function dismissAutomationBan(userId: string, programId: string, phrase: string, expectedPolicyVersion: number) {
  return prisma.$transaction(async tx => {
    const program = await lockOwnedProgram(tx, userId, programId);
    const latest = await tx.programExecutionPolicy.findFirst({ where: { programId }, orderBy: currentPolicySelection.orderBy });
    const previous = latest ? storedExecutionPolicySchema.parse(latest.policy) : undefined;
    const decisions = previous?.automationDecisions ?? [];
    // A replay of an accepted click creates no duplicate versions.
    if (decisions.some(decision => decision.phrase === phrase)) return { version: latest!.version, applied: true };
    if ((latest?.version ?? 0) !== expectedPolicyVersion) throw new ResearchError('Policy changed. Reload the Target before applying this decision.', 409);
    const current = resolveProgramPolicy({ ...program, executionPolicies: latest ? [latest] : [] });
    if (!current.automationBlocked || current.automationProhibition !== phrase) throw new ResearchError('This phrase is no longer the current automation block. Reload the Target.', 409);
    const now = new Date();
    const policy = {
      ...(previous ?? {
        automationAllowed: false, requiredUserAgent: program.requiredUserAgent || null, requiredHeaders: [], exclusions: [],
        ...LEGACY_LIMITS, forbiddenCategories: [],
        sourceSnapshot: { url: program.programUrl, rules: program.rulesOfEngagement ?? '', unrepresentedRules: [] },
      }),
      automationAllowed: true,
      // Keep the original evidence for provenance; the decision excludes it.
      automationProhibition: phrase,
      automationDecisions: [...decisions, { phrase, decision: 'NOT_A_TESTING_BAN' as const, userId, decidedAt: now.toISOString() }],
    };
    const version = (latest?.version ?? 0) + 1;
    await tx.programExecutionPolicy.create({ data: { programId, version, policy } });
    await tx.bountyProgram.update({ where: { id: programId }, data: { updatedAt: new Date(Math.max(+now, +program.updatedAt + 1)) } });
    const resolved = resolveProgramPolicy({ ...program, executionPolicies: [{ version, policy }] });
    const hasAssets = await tx.scopeAsset.count({ where: { programId, active: true } });
    const blocker = resolved.blocker ?? (!hasAssets ? 'Add at least one active Scope Asset before Recon.' : null);
    const campaign = await tx.targetCampaign.findUnique({ where: { programId } });
    if (campaign) await tx.targetCampaign.update({ where: { programId }, data: campaignAfterReview(campaign, blocker, campaign.intervalMinutes, now) });
    logger.info({ operation: 'automation-decision', programId, userId, version }, 'Program phrase classified as not a testing ban');
    return { version, applied: true, blocker };
  });
}
