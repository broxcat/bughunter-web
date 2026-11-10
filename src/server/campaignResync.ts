import { findAutomationProhibition, isReportingRestriction, sameAutomationPhrase } from '@/lib/automationProhibition.mjs';
import { isDeepStrictEqual } from 'node:util';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { matchesHost } from '@/lib/bountyProgram';
import { assetAllowsHost, assetAllowsUrl, detectScopeAsset } from '@/lib/scopeAssets';
import { campaignSourceSchema, pendingScopeSchema, type CampaignSource } from '@/lib/campaignSource';
import { storedExecutionPolicySchema } from '@/lib/programExecutionPolicy';
import { campaignPolicyBlocker } from './campaignOrchestrator';
import { programPolicyInclude } from './programExecutionPolicy';
import { detectProgram } from './programImport/preview';
import { publicProgramText } from './programImport/publicPage';
import { campaignSourceFromIntake, extractProgram } from './programImport/intake';
import { lockOwnedProgram, retireScopeAssetInTransaction, settleScopeAssetRetirement } from './scopeAssets';

export const CAMPAIGN_SYNC_INTERVAL = 24 * 60 * 60 * 1000;
const active = ['QUEUED', 'RUNNING'] as const;
const ruleKey = (rule: { text: string; assetRef?: string }) => JSON.stringify([rule.assetRef ?? null, rule.text]);

function covers(grant: string, target: string) {
  try {
    const a = detectScopeAsset(grant), b = detectScopeAsset(target);
    if (a.normalizedValue === b.normalizedValue) return true;
    if (a.format === 'URL') return b.format === 'URL' && assetAllowsUrl(a, b.normalizedValue);
    return b.hostname ? assetAllowsHost(a, b.hostname)
      : a.format === 'WILDCARD_DOMAIN' && b.format === 'WILDCARD_DOMAIN' && matchesHost(b.normalizedValue, a.normalizedValue);
  } catch { return false; }
}

function overlaps(exclusion: string, asset: string) {
  const denied = detectScopeAsset(exclusion);
  if (denied.format === 'IP' || denied.format === 'CIDR') return true;
  const target = detectScopeAsset(asset);
  if (denied.format === 'URL' && target.format === 'URL') {
    const a = new URL(denied.normalizedValue), b = new URL(target.normalizedValue);
    const path = (url: URL) => url.pathname.toLowerCase().replace(/\/\*$/, '/').replace(/\/$/, '');
    const x = path(a), y = path(b);
    return a.origin === b.origin && (!x || !y || x === y || x.startsWith(y + '/') || y.startsWith(x + '/'));
  }
  return covers(exclusion, asset) || covers(asset, exclusion.replace(/\/\*$/, '/'));
}

/** The network fetch runs outside the row lock. Persist the claim first so
 * concurrent workers and restarts cannot exceed one resync per Target per day. */
export async function resyncCampaign(ownerId: string, programId: string, now = new Date(),
  fetchSource?: (ownerId: string, reference: { url: string; platform: CampaignSource['platform'] }) => Promise<CampaignSource>) {
  const claim = await prisma.$transaction(async tx => {
    await lockOwnedProgram(tx, ownerId, programId);
    const [row, program] = await Promise.all([
      tx.targetCampaign.findUnique({ where: { programId } }),
      tx.bountyProgram.findUniqueOrThrow({ where: { id: programId }, include: programPolicyInclude }),
    ]);
    if (!row || row.state === 'PAUSED' || row.state === 'BLOCKED' || campaignPolicyBlocker(program) ||
        (row.lastSyncAt && +now - +row.lastSyncAt < CAMPAIGN_SYNC_INTERVAL)) return null;
    const detected = program.programUrl && program.platform ? detectProgram(program.programUrl) : null;
    await tx.targetCampaign.update({ where: { programId }, data: { lastSyncAt: now } });
    if (!detected || detected.reference.platform !== program.platform) return null;
    const baseline = campaignSourceSchema.safeParse(row.source).data;
    const policy = storedExecutionPolicySchema.safeParse(program.executionPolicies[0]?.policy).data;
    if (!fetchSource && (!policy?.sourceSnapshot.intakeVersion || !baseline || baseline.url !== detected.reference.url)) return null;
    return { ...detected.reference, baseline };
  });
  if (!claim) return;
  let fresh: CampaignSource;
  if (fetchSource) fresh = campaignSourceSchema.parse(await fetchSource(ownerId, { url: claim.url, platform: claim.platform }));
  else {
    const page = await publicProgramText(claim.url);
    if (page.text === (claim.baseline?.sourceDocument ?? claim.baseline?.rules[0]?.text)) return;
    // Record the new source document even when extraction is unavailable.
    try {
      const preview = await extractProgram(ownerId, { mode: 'url', url: claim.url });
      fresh = campaignSourceFromIntake(preview)!;
    } catch {
      fresh = { ...claim.baseline!, sourceDocument: page.text, rules: [{ text: 'The public program changed and its rules could not be extracted.' }] };
    }
  }
  if (fresh.platform !== claim.platform || fresh.url !== claim.url) return;
  const retired = await prisma.$transaction(async tx => {
    await lockOwnedProgram(tx, ownerId, programId);
    const [row, program] = await Promise.all([
      tx.targetCampaign.findUnique({ where: { programId } }),
      tx.bountyProgram.findUniqueOrThrow({ where: { id: programId }, include: programPolicyInclude }),
    ]);
    if (!row || +row.lastSyncAt! !== +now || program.platform !== claim.platform || !program.programUrl ||
        detectProgram(program.programUrl)?.reference.url !== claim.url || campaignPolicyBlocker(program)) return [];
    const latest = program.executionPolicies[0];
    const policy = storedExecutionPolicySchema.parse(latest.policy);
    const previous = campaignSourceSchema.safeParse(row.source).data;
    const sameSource = previous?.url === fresh.url && previous.platform === fresh.platform ? previous : undefined;
    const existing = await tx.scopeAsset.findMany({ where: { programId, active: true } });
    const removed = existing.filter(asset => (!sameSource || sameSource.grants.some(grant => covers(grant, asset.normalizedValue))) &&
      !fresh.grants.some(grant => covers(grant, asset.normalizedValue)));
    for (const asset of removed) await retireScopeAssetInTransaction(tx, programId, asset);
    const activeValues = new Set(existing.filter(asset => !removed.includes(asset)).map(asset => asset.normalizedValue));
    const priorAssets = new Set(sameSource?.assets.map(asset => asset.value) ?? []);
    const priorPending = new Set((pendingScopeSchema.safeParse(row.pendingAssets).data ?? []).map(asset => asset.value));
    const pendingAssets = fresh.assets.filter(asset => !activeValues.has(asset.value) && (!priorAssets.has(asset.value) || priorPending.has(asset.value)));

    const priorExclusions = new Set(policy.exclusions.map(value => detectScopeAsset(value).normalizedValue));
    const newExclusions = fresh.exclusions.filter(value => !priorExclusions.has(detectScopeAsset(value).normalizedValue));
    const newCategories = fresh.forbiddenCategories.filter(category => !policy.forbiddenCategories.includes(category));
    const existingDocument = policy.sourceSnapshot.sourceDocument ?? policy.sourceSnapshot.rules;
    const rulesChanged = sameSource ? !isDeepStrictEqual(sameSource.rules.map(ruleKey), fresh.rules.map(ruleKey))
      : fresh.rules.some(rule => !existingDocument.includes(rule.text));
    const newFamilies = fresh.nonQualifying.filter(family => !program.nonQualifying.includes(family));
    const ignoredPhrases = policy.automationDecisions?.map(decision => decision.phrase) ?? [];
    const preferred = fresh.automationProhibition;
    const automationProhibition = (preferred && !isReportingRestriction(preferred) && !ignoredPhrases.some(phrase => sameAutomationPhrase(phrase, preferred)) ? preferred : null)
      ?? findAutomationProhibition(fresh.sourceDocument ?? fresh.rules.map(rule => rule.text).join('\n'), ignoredPhrases);
    const automationDenied = automationProhibition !== null;
    if (automationDenied || removed.length || newExclusions.length || newCategories.length || rulesChanged || newFamilies.length) {
      const nextPolicy = {
        ...policy,
        automationAllowed: policy.automationAllowed && !automationDenied,
        ...(automationDenied ? { automationProhibition } : {}),
        exclusions: [...policy.exclusions, ...newExclusions],
        forbiddenCategories: [...policy.forbiddenCategories, ...newCategories],
        sourceSnapshot: {
          ...policy.sourceSnapshot,
          ...(rulesChanged ? { sourceDocument: fresh.sourceDocument ?? fresh.rules.map(rule => rule.text).join('\n\n') } : {}),
        },
      };
      await tx.bountyProgram.update({ where: { id: programId }, data: {
        nonQualifying: [...program.nonQualifying, ...newFamilies],
        executionPolicies: { create: { version: latest.version + 1, policy: nextPolicy } },
      } });
      const affected = existing.filter(asset => newExclusions.some(exclusion => overlaps(exclusion, asset.normalizedValue)));
      if (automationDenied || newCategories.length || affected.length) {
        await tx.scanRun.updateMany({ where: {
          target: { programId, userId: ownerId }, status: { in: [...active] }, cancelRequestedAt: null,
          ...(!automationDenied && !newCategories.length ? { OR: [
            { scopeAssetId: { in: affected.map(asset => asset.id) } },
            { target: { discoveredFromAssetId: { in: affected.map(asset => asset.id) } } },
          ] } : {}),
        }, data: { cancelRequestedAt: now } });
      }
    }
    await tx.targetCampaign.update({ where: { programId }, data: {
      source: fresh as Prisma.InputJsonValue, pendingAssets,
    } });
    return removed.map(asset => asset.id);
  }, { timeout: 30000 });
  if (retired.length) await settleScopeAssetRetirement().catch(() => undefined);
}
