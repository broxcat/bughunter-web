import { isDeepStrictEqual } from 'node:util';
import { Prisma } from '@prisma/client';
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { currentPolicySelection, programPolicyInclude } from '@/server/programExecutionPolicy';
import { campaignAfterReview, campaignDueAt, campaignPolicyBlocker, cancelCampaignScans } from '@/server/campaignOrchestrator';
import { pendingScopeSchema } from '@/lib/campaignSource';
import { z } from 'zod';
import { convertLegacyExclusions, legacyExclusionParity, legacyFreeText, legacyScopeFingerprint, readLegacyScopes } from '@/server/legacyPolicySource';
import { executionPolicySchema, hasHunterUsername, policyDraftNeedsReview, storedExecutionPolicySchema } from '@/lib/programExecutionPolicy';
import { programUpdateSchema } from "@/lib/bountyProgram";
import { deleteProgram } from '@/server/programDeletion';
import { ResearchError } from '@/server/research/workspace';
import { targetIdentity } from '@/lib/research/terminal';
import { foreignOrigin } from '@/lib/requestOrigin';
import { targetReviewSchema } from '@/lib/targetReview';
import { scopeEntriesForSettings, targetScopeVersion, reviewedPolicy as buildReviewedPolicy, storeTestAccounts, updateReviewedScope } from '@/server/targetReview';
import { settleScopeAssetRetirement } from '@/server/scopeAssets';
import { resolveDefaultAiConfig } from '@/server/brain/config';
import { requiredUserAgentSchema } from '@/lib/httpPolicy.mjs';

type Params = { params: Promise<{ id: string }> };
export async function GET(_req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const program = await prisma.bountyProgram.findFirst({ where: { id, ownerId: session.user.id }, include: { executionPolicies: currentPolicySelection, targets: { where: { active: true, contextOnly: false, userId: session.user.id }, orderBy: [{host:'asc'},{id:'asc'}] } } });
  if (!program) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const [scopes, assets, ai, campaign] = await Promise.all([
    readLegacyScopes(prisma, id, session.user.id),
    prisma.scopeAsset.findMany({ where: { programId: id, active: true } }),
    resolveDefaultAiConfig(session.user.id, { includeApiKey: false }).catch(() => null),
    prisma.targetCampaign.findUnique({ where: { programId: id }, select: { intervalMinutes: true, pendingAssets: true } }),
  ]);
  const scopeFingerprint = legacyScopeFingerprint(scopes);
  const latest = storedExecutionPolicySchema.safeParse(program.executionPolicies[0]?.policy).data;
  const reviewedScopes = latest?.sourceSnapshot.legacy?.scopes ?? [];
  return NextResponse.json({
    ...program,
    scopeIn: scopeEntriesForSettings(program, assets),
    expectedAssets: targetScopeVersion(assets),
    hunterHasUserAgent: requiredUserAgentSchema.safeParse(process.env.DEFAULT_USER_AGENT).success,
    hunterHasUsername: hasHunterUsername(process.env.HUNTER_USERNAME),
    hasAi: Boolean(ai),
    campaign: campaign ? { intervalMinutes: campaign.intervalMinutes, pendingAssets: pendingScopeSchema.safeParse(campaign.pendingAssets).data ?? [] } : null,
    legacyPolicyReview: {
      scopes, scopeFingerprint, scopeChanged: scopeFingerprint !== legacyScopeFingerprint(reviewedScopes),
      ...convertLegacyExclusions(program.outOfScope),
      unrepresentedRules: legacyFreeText(program.rulesOfEngagement, scopes),
    },
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
export async function PATCH(req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const parsed = programUpdateSchema.extend({
    executionPolicy: executionPolicySchema.optional(),
    targetReview: targetReviewSchema.optional(),
    expectedPolicyVersion: z.number().int().min(0).optional(),
    expectedLegacyScopeFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  const program = await prisma.bountyProgram.findFirst({ where: { id, ownerId: session.user.id, deletingAt: null } });
  if (!program) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const retired: string[] = [];
  try {
    const response = await prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{id:string}[]>`SELECT id FROM "BountyProgram" WHERE id=${id} AND "ownerId"=${session.user.id} AND "deletingAt" IS NULL FOR UPDATE`;
      if (!rows.length) return Response.json({ error: 'Target unavailable' }, { status: 409 });
      // The preflight read establishes existence only. Another policy writer can
      // commit before this lock is acquired; derive removals from the locked row.
      const current = await tx.bountyProgram.findUniqueOrThrow({ where: { id }, select: { scopeRules: true, updatedAt: true, programUrl: true, platform: true, rulesOfEngagement: true, outOfScope: true, executionPolicies: { ...currentPolicySelection, select: { version: true, policy: true } } } });
      if(parsed.data.expectedUpdatedAt&&current.updatedAt.toISOString()!==parsed.data.expectedUpdatedAt)return Response.json({error:'Target settings changed. Reload before saving.'},{status:409});
      const { executionPolicy, targetReview, expectedPolicyVersion, expectedLegacyScopeFingerprint, ...changes } = parsed.data;
      if (targetReview && (executionPolicy || changes.scopeRules || !changes.expectedUpdatedAt || expectedPolicyVersion === undefined)) {
        return Response.json({ error: 'Reload Target settings and save one reviewed policy.' }, { status: 400 });
      }
      delete changes.expectedUpdatedAt;
      if (executionPolicy && (executionPolicy.sourceSnapshot.rules !== (changes.rulesOfEngagement === undefined ? current.rulesOfEngagement?.trim() ?? '' : changes.rulesOfEngagement ?? '') ||
          executionPolicy.sourceSnapshot.url !== (changes.programUrl === undefined ? current.programUrl : changes.programUrl))) {
        return Response.json({ error: 'The execution policy source must match the current program URL and rules.' }, { status: 400 });
      }
      let reviewedPolicy;
      if (executionPolicy || targetReview) {
        const latest = current.executionPolicies[0];
        const currentVersion = latest?.version ?? 0;
        const previousPolicy = storedExecutionPolicySchema.safeParse(latest?.policy).data;
        const reviewState = previousPolicy?.reviewState;
        if (!targetReview && previousPolicy?.sourceSnapshot.ruleDecisions) {
          return Response.json({ error: 'Use the Target review form to update reviewed scope and rule decisions.' }, { status: 409 });
        }
        const isDraft = policyDraftNeedsReview(reviewState);
        if ((expectedPolicyVersion !== undefined || isDraft) && expectedPolicyVersion !== currentVersion) {
          return Response.json({ error: 'Execution policy changed. Reload and review the current version before saving.' }, { status: 409 });
        }
        const scopes = await readLegacyScopes(tx, id, session.user.id!);
        if ((expectedLegacyScopeFingerprint !== undefined || scopes.length > 0) &&
            expectedLegacyScopeFingerprint !== legacyScopeFingerprint(scopes)) {
          return Response.json({ error: 'Legacy Scope text changed or has not been reviewed. Reload Target settings.' }, { status: 409 });
        }
        const outOfScope = changes.outOfScope ?? current.outOfScope;
        const policy = targetReview?.policy ?? executionPolicy!;
        if (policy.automationAllowed && !targetReview?.rules.some(rule => !rule.decision)) {
          const parity = legacyExclusionParity(outOfScope, policy.exclusions);
          if (parity.missing.length || parity.unconvertible.length) {
            return Response.json({ error: 'Automation requires matching structured exclusions for every legacy exclusion.', ...parity }, { status: 400 });
          }
        }
        if (targetReview) {
          const effective = {
            programUrl: changes.programUrl === undefined ? current.programUrl : changes.programUrl,
            rulesOfEngagement: changes.rulesOfEngagement === undefined ? current.rulesOfEngagement : changes.rulesOfEngagement,
            outOfScope,
          };
          const program = await tx.bountyProgram.findUniqueOrThrow({ where: { id } });
          const scope = await updateReviewedScope(tx, program, targetReview);
          retired.push(...scope.retired);
          changes.scopeRules = scope.scopeRules;
          changes.requiredUserAgent = policy.requiredUserAgent ?? '';
          const previousSource = previousPolicy?.sourceSnapshot;
          const documented = new Map((previousSource?.documentedAssets ?? []).map(asset => [asset.ref, asset]));
          for (const asset of targetReview.documentedAssets) documented.set(asset.ref, asset);
          const nextPolicy = buildReviewedPolicy({ ...targetReview, documentedAssets: [...documented.values()],
            sourceDocument: targetReview.intakeVersion && targetReview.sourceDocument !== undefined
              ? targetReview.sourceDocument : previousSource?.sourceDocument ?? targetReview.sourceDocument,
            intakeVersion: targetReview.intakeVersion ?? previousSource?.intakeVersion,
            nonQualifyingText: targetReview.nonQualifyingText ?? previousSource?.nonQualifyingText,
          }, effective, scopes);
          await storeTestAccounts(tx, { ...program, ...effective }, targetReview, nextPolicy);
          reviewedPolicy = nextPolicy;
        } else reviewedPolicy = {
          ...executionPolicy!, reviewState: isDraft && !policy.automationAllowed ? reviewState : 'OWNER_REVIEWED',
          sourceSnapshot: {
            ...executionPolicy!.sourceSnapshot,
            legacy: {
              outOfScope, scopes,
              programRules: changes.rulesOfEngagement === undefined ? current.rulesOfEngagement : changes.rulesOfEngagement,
            },
          },
        };
      }
      if (!targetReview && parsed.data.scopeRules) {
        const removed = current.scopeRules.filter(rule => !parsed.data.scopeRules!.includes(rule));
        const assets = await tx.scopeAsset.findMany({ where: { programId: id, normalizedValue: { in: removed }, active: true }, select: { id: true } });
        if (await tx.scanRun.count({ where: { scopeAssetId: { in: assets.map(a => a.id) }, status: { in: ['QUEUED', 'RUNNING'] } } })) return Response.json({ error: 'Stop active Recon before removing its scope rules' }, { status: 409 });
        await tx.scopeAsset.updateMany({ where: { id: { in: assets.map(a => a.id) } }, data: { active: false } });
      }
      const saved = await tx.bountyProgram.update({ where: { id }, data: {
        ...changes,
        ...(reviewedPolicy && !isDeepStrictEqual(reviewedPolicy, current.executionPolicies[0]?.policy) ? { executionPolicies: { create: { version: (current.executionPolicies[0]?.version ?? 0) + 1, policy: reviewedPolicy } } } : {}),
        updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)),
      } });
      if (targetReview) {
        const campaign = await tx.targetCampaign.findUnique({ where: { programId: id } });
        const interval = targetReview.campaignInterval === undefined ? campaign?.intervalMinutes ?? null : targetReview.campaignInterval;
        if (campaign || interval !== null) {
          const policyProgram = await tx.bountyProgram.findUniqueOrThrow({ where: { id }, include: programPolicyInclude });
          const blocker = campaignPolicyBlocker(policyProgram);
          if (blocker) await cancelCampaignScans(tx, session.user.id!, id, false);
          if (campaign) {
            const reviewedAssets = new Set((await tx.scopeAsset.findMany({ where: { programId: id, active: true }, select: { normalizedValue: true } }))
              .map(asset => asset.normalizedValue));
            const sourceChanged = current.programUrl !== saved.programUrl || current.platform !== saved.platform;
            const pending = pendingScopeSchema.safeParse(campaign.pendingAssets).data ?? [];
            const imported = targetReview.importSource;
            const matchedSource = imported?.url === saved.programUrl && imported?.platform === saved.platform ? imported : undefined;
            await tx.targetCampaign.update({ where: { programId: id }, data: {
              ...campaignAfterReview(campaign, blocker, interval),
              ...(matchedSource ? { source: matchedSource, lastSyncAt: new Date(), pendingAssets: [] }
                : sourceChanged ? { source: Prisma.DbNull, pendingAssets: [] }
                  : { pendingAssets: pending.filter(asset => !reviewedAssets.has(asset.value)) }),
            } });
          } else {
            await tx.targetCampaign.create({ data: { programId: id, intervalMinutes: interval,
              state: blocker ? 'BLOCKED' : 'MONITORING', reason: blocker, nextCycleAt: blocker ? null : campaignDueAt(interval, new Date()),
              source: targetReview.importSource?.url === saved.programUrl && targetReview.importSource?.platform === saved.platform ? targetReview.importSource : undefined } });
          }
        }
      }
      return NextResponse.json(saved);
    }, { timeout: 30000 });
    if (response.ok) {
      const cleanup = await Promise.allSettled(retired.map(assetId => settleScopeAssetRetirement(session.user.id!, assetId)));
      if (cleanup.some(result => result.status === 'rejected')) response.headers.set('X-Scope-Cleanup-Pending', '1');
    }
    return response;
  } catch (error) {
    return Response.json({ error: error instanceof ResearchError ? error.message : 'Target settings could not be saved.' },
      { status: error instanceof ResearchError ? error.status : 503 });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (foreignOrigin(_req)) return Response.json({error:'Forbidden'},{status:403});
  const { id } = await params;
  if (!targetIdentity.safeParse(id).success) return Response.json({ error: 'Invalid target' }, { status: 400 });
  try { await deleteProgram(session.user.id, id); return Response.json({ deleted: true }); }
  catch (e) { return Response.json({ error: e instanceof ResearchError ? e.message : 'Deletion incomplete; target remains blocked. Retry deletion.' }, { status: e instanceof ResearchError ? e.status : 503 }); }
}
