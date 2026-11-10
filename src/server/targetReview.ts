import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { encryptSecret } from '@/lib/crypto';
import { detectScopeAsset, scopeAssetExecutable } from '@/lib/scopeAssets';
import type { TargetReview } from '@/lib/targetReview';
import type { LegacyScopeText } from '@/lib/programExecutionPolicy';
import { excludedByPolicy, resolveProgramPolicy } from './programExecutionPolicy';
import { ensureAssetExecutionInTransaction, retireScopeAssetInTransaction } from './scopeAssets';
import { ResearchError } from './research/workspace';

type Program = Prisma.BountyProgramGetPayload<object>;
type Asset = Prisma.ScopeAssetGetPayload<object>;
const discoveryFormats = ['DOMAIN', 'SUBDOMAIN', 'WILDCARD_DOMAIN'];
const byValue = (a: Asset, b: Asset) => a.normalizedValue < b.normalizedValue ? -1 : a.normalizedValue > b.normalizedValue ? 1 : 0;

export function reviewedPolicy(review: TargetReview, program: Pick<Program, 'programUrl' | 'rulesOfEngagement' | 'outOfScope'>, scopes: LegacyScopeText[]) {
  return {
    ...review.policy,
    sourceSnapshot: {
      url: program.programUrl,
      rules: program.rulesOfEngagement?.trim() ?? '',
      unrepresentedRules: review.rules.filter(rule => !rule.decision).map(rule => rule.assetRef ? '[' + rule.assetRef + '] ' + rule.text : rule.text),
      ruleDecisions: review.rules,
      documentedAssets: review.documentedAssets,
      ...(review.sourceDocument !== undefined ? { sourceDocument: review.sourceDocument } : {}),
      ...(review.programSections ? { programSections: review.programSections } : {}),
      ...(review.intakeVersion ? { intakeVersion: review.intakeVersion } : {}),
      ...(review.nonQualifyingText !== undefined ? { nonQualifyingText: review.nonQualifyingText } : {}),
      legacy: { scopes, outOfScope: program.outOfScope, programRules: program.rulesOfEngagement },
    },
  };
}

export function reviewedAssetData(scopeIn: TargetReview['scopeIn']) {
  return scopeIn.map(({ value, type, assetValue }) => {
    const { format, normalizedValue } = detectScopeAsset(value);
    return { originalValue: value, normalizedValue, format, type, typeSource: 'USER', ...(assetValue ? { assetValue } : {}) };
  });
}

export function targetScopeVersion(assets: Asset[]) {
  return createHash('sha256').update(JSON.stringify([...assets].sort(byValue).map(asset => [asset.id, asset.updatedAt]))).digest('hex');
}

export function scopeEntriesForSettings(program: Pick<Program, 'scopeRules'>, assets: Asset[]) {
  const scope = new Map<string, TargetReview['scopeIn'][number]>(assets.filter(scopeAssetExecutable).sort(byValue).map(asset => [
    asset.normalizedValue, { value: asset.normalizedValue, type: asset.type, assetValue: asset.assetValue },
  ]));
  for (const value of program.scopeRules) {
    try {
      const asset = detectScopeAsset(value);
      if (asset.executable && !scope.has(asset.normalizedValue)) scope.set(asset.normalizedValue, { value: asset.normalizedValue, type: asset.inferredType });
    } catch { /* Older unparseable rules are preserved without reinterpretation. */ }
  }
  return [...scope.values()];
}

export function discoveryScopeRules(assets: ReturnType<typeof reviewedAssetData>) {
  return assets.filter(asset => discoveryFormats.includes(asset.format)).map(asset => asset.normalizedValue);
}

export async function updateReviewedScope(tx: Prisma.TransactionClient, program: Program, review: TargetReview) {
  const current = await tx.scopeAsset.findMany({ where: { programId: program.id } });
  const active = current.filter(asset => asset.active);
  if (review.expectedAssets !== targetScopeVersion(active)) throw new ResearchError('Scope changed. Reload Target settings before saving.', 409);
  const desired = reviewedAssetData(review.scopeIn);
  const desiredValues = new Set(desired.map(asset => asset.normalizedValue));
  const byIdentity = new Map(current.map(asset => [asset.normalizedValue, asset]));
  const retired: string[] = [];
  for (const asset of active.filter(asset => scopeAssetExecutable(asset) && !desiredValues.has(asset.normalizedValue))) {
    await retireScopeAssetInTransaction(tx, program.id, asset);
    retired.push(asset.id);
  }
  const additions = [];
  for (const next of desired) {
    const old = byIdentity.get(next.normalizedValue);
    if (next.type === 'OTHER' && old?.type !== 'OTHER') throw new ResearchError('Use a web asset type or keep the asset for reference.', 400);
    if (!old) { additions.push({ ...next, programId: program.id }); continue; }
    if (!old.active && old.format !== next.format) throw new ResearchError('Scope value belongs to a retained identity with a different format.', 409);
    if (!old.active || old.type !== next.type || next.assetValue && old.assetValue !== next.assetValue) {
      await tx.scopeAsset.update({ where: { id: old.id }, data: { active: true, type: next.type, typeSource: 'USER', ...(next.assetValue ? { assetValue: next.assetValue } : {}),
        updatedAt: new Date(Math.max(Date.now(), old.updatedAt.getTime() + 1)) } });
    }
  }
  if (additions.length) await tx.scopeAsset.createMany({ data: additions });
  const legacy = program.scopeRules.filter(value => {
    try { return !detectScopeAsset(value).executable; } catch { return true; }
  });
  const retainedFormats = desired.map(asset => ({ ...asset, format: byIdentity.get(asset.normalizedValue)?.format ?? asset.format }));
  return { retired, scopeRules: [...new Set([...legacy, ...discoveryScopeRules(retainedFormats)])] };
}

export async function storeTestAccounts(tx: Prisma.TransactionClient, program: Program, review: TargetReview, policy: ReturnType<typeof reviewedPolicy>) {
  if (!review.testAccounts.length) return;
  const resolved = resolveProgramPolicy({ ...program, executionPolicies: [{ version: 1, policy }] });
  for (const account of review.testAccounts) {
    const login = new URL(account.loginUrl);
    if (excludedByPolicy(resolved, login.hostname, login)) throw new ResearchError('Test account login is excluded by program policy.', 400);
    const normalizedValue = detectScopeAsset(account.asset).normalizedValue;
    const asset = await tx.scopeAsset.findUniqueOrThrow({ where: { programId_normalizedValue: { programId: program.id, normalizedValue } } });
    const { target } = await ensureAssetExecutionInTransaction(tx, program.ownerId, program, asset.id);
    if (await tx.targetCredential.findFirst({ where: { targetId: target.id, purpose: account.purpose }, select: { id: true } })) {
      throw new ResearchError('A test account with that role already exists for this asset.', 409);
    }
    await tx.targetCredential.create({ data: {
      targetId: target.id, purpose: account.purpose, mode: 'EMAIL_PASSWORD', label: account.purpose === 'ACCOUNT_A' ? 'Account A' : 'Account B',
      loginUrl: account.loginUrl, emailCipher: encryptSecret(account.username), passwordCipher: encryptSecret(account.password),
    } });
  }
}
