
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { detectScopeAsset } from '@/lib/scopeAssets';
import { structuredExclusionSchema, type LegacyScopeText } from '@/lib/programExecutionPolicy';

const textFields = ['scopeDetails', 'outOfScope', 'rulesOfEngagement'] as const;
export const legacyScopeSelect = { id: true, userId: true, scopeDetails: true, outOfScope: true, rulesOfEngagement: true } as const;
export const scopeWithLegacyText = {
  OR: textFields.map(field => ({ [field]: { not: null } })),
} satisfies Prisma.ScopeWhereInput;
export const legacyScopeTargets = {
  where: { scope: scopeWithLegacyText },
  select: { scope: { select: legacyScopeSelect } },
} satisfies Prisma.BountyProgram$targetsArgs;

export function captureLegacyScopes(
  rows: readonly (LegacyScopeText & { userId?: string })[],
  ownerId?: string,
): LegacyScopeText[] {
  const scopes = new Map<string, LegacyScopeText>();
  for (const { id, userId, scopeDetails, outOfScope, rulesOfEngagement } of rows) {
    if (ownerId && userId !== ownerId) continue;
    if ([scopeDetails, outOfScope, rulesOfEngagement].some(value => value?.trim())) {
      scopes.set(id, { id, scopeDetails, outOfScope, rulesOfEngagement });
    }
  }
  return [...scopes.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function legacyScopeFingerprint(scopes: readonly LegacyScopeText[]) {
  const ordered = captureLegacyScopes(scopes);
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

export async function readLegacyScopes(db: Pick<Prisma.TransactionClient, 'scope'>, programId: string, ownerId: string) {
  const scopes = await db.scope.findMany({
    where: { ...scopeWithLegacyText, userId: ownerId, targets: { some: { programId } } },
    select: legacyScopeSelect,
  });
  return captureLegacyScopes(scopes, ownerId);
}

export function legacyFreeText(programRules: string | null, scopes: readonly LegacyScopeText[]) {
  const fields = [programRules, ...scopes.flatMap(scope => textFields.map(field => scope[field]))];
  return [...new Set(fields.filter((text): text is string => Boolean(text?.trim())))];
}

export function convertLegacyExclusions(values: readonly string[]) {
  const exclusions = new Set<string>();
  const unconvertible: { index: number; value: string; reason: string }[] = [];
  for (const [index, value] of values.entries()) {
    try {
      const { normalizedValue } = detectScopeAsset(value);
      const parsed = structuredExclusionSchema.safeParse(normalizedValue);
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      if (exclusions.size === 1000 && !exclusions.has(normalizedValue)) throw new Error('Structured policy limit of 1000 exclusions exceeded');
      exclusions.add(normalizedValue);
    } catch (error) {
      unconvertible.push({ index, value, reason: error instanceof Error ? error.message : 'Unsupported exclusion' });
    }
  }
  return { exclusions: [...exclusions], unconvertible };
}

export function legacyExclusionParity(values: readonly string[], structured: readonly string[]) {
  const { exclusions, unconvertible } = convertLegacyExclusions(values);
  const normalized = new Set(structured.map(value => detectScopeAsset(value).normalizedValue));
  return { missing: exclusions.filter(value => !normalized.has(value)), unconvertible };
}
