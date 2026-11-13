import type { Prisma } from '@prisma/client';
import { matchesHost, normalizeFqdn } from '@/lib/bountyProgram';
import { safeObservationUrl, redactObservationText } from '@/lib/observationSafety';
import { assetAllowsHost } from '@/lib/scopeAssets';
import { scanRejection } from '@/server/execution';
import { programPolicyInclude, resolveProgramPolicy } from '@/server/programExecutionPolicy';

export const researchTargetSelect = {
  scopeAsset: { select: { id: true, programId: true, originalValue: true, normalizedValue: true, format: true, type: true, assetValue: true, active: true, updatedAt: true } },
  discoveredFromAsset: { select: { id: true, programId: true, originalValue: true, normalizedValue: true, format: true, type: true, assetValue: true, active: true, updatedAt: true } },
  id: true, userId: true, host: true, scheme: true, active: true, contextOnly: true, discoverySource: true,
  scope: { select: { updatedAt: true, id: true, userId: true, hostPattern: true, status: true, rulesOfEngagement: true, scopeDetails: true, outOfScope: true, disclosurePolicy: true, safeHarbor: true, legalTerms: true, eligibilityCriteria: true, reportingFormat: true } },
  program: { select: { ...programPolicyInclude, programUrl: true, updatedAt: true, id: true, ownerId: true, companyName: true, requiredUserAgent: true, scopeRules: true, rulesOfEngagement: true, deletingAt: true, outOfScope: true, qualifying: true, nonQualifying: true } },
  credentials: { select: { label: true, purpose: true, sessionStatus: true } },
} satisfies Prisma.TargetSelect;

type SelectedResearchTarget = Prisma.TargetGetPayload<{ select: typeof researchTargetSelect }>;
type SelectedProgram = NonNullable<SelectedResearchTarget['program']>;
type PolicyFields = 'programUrl' | 'executionPolicies' | 'targets';
export type ResearchTarget = Omit<SelectedResearchTarget, 'scopeAsset' | 'discoveredFromAsset' | 'program'> &
  Partial<Pick<SelectedResearchTarget, 'scopeAsset' | 'discoveredFromAsset'>> & {
    program: (Omit<SelectedProgram, PolicyFields> & Partial<Pick<SelectedProgram, PolicyFields>>) | null;
  };

export class ResearchError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export const researchUserAgent = (target: ResearchTarget) => resolveProgramPolicy(target.program!).userAgent;
export const researchIsPassive = (target: ResearchTarget) => target.scopeAsset ? target.scopeAsset.format === 'WILDCARD_DOMAIN' : target.contextOnly;

export function assertResearchTarget(target: ResearchTarget, userId: string) {
  if (target.userId !== userId || target.scope.userId !== userId || target.program?.ownerId !== userId) throw new ResearchError('Target not found', 404);
  if (target.program?.deletingAt) throw new ResearchError('Target deletion is in progress', 409);
  const boundary = target.scopeAsset ?? target.discoveredFromAsset;
  if (boundary && (!boundary.active || (target.scopeAsset?.format !== 'WILDCARD_DOMAIN' && !assetAllowsHost(boundary, target.host)))) {
    throw new ResearchError('Scope asset authorization is no longer active', 409);
  }
  const policy = resolveProgramPolicy(target.program!);
  const legacyExclusions = !policy.reviewedScope ? target.scope.outOfScope?.toLowerCase().match(/(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+/g) ?? [] : [];
  if (boundary && legacyExclusions.some(rule => matchesHost(target.host, rule))) throw new ResearchError('Host is explicitly out of scope');
  if (target.scopeAsset) {
    if (target.scope.status !== 'APPROVED') throw new ResearchError('Scope is not approved');
    if (target.scopeAsset.format === 'WILDCARD_DOMAIN') return;
    const rejection = scanRejection(target, 'HOST');
    if (rejection) throw new ResearchError(rejection);
    return;
  }
  if (target.contextOnly) {
    if (target.scope.status !== 'APPROVED') throw new ResearchError('Program scope is not approved');
    return;
  }
  const rejection = scanRejection(target, 'HOST');
  if (rejection) throw new ResearchError(rejection);
  try {
    if (normalizeFqdn(target.host) !== target.host || !matchesHost(target.host, target.scope.hostPattern)) throw new Error();
  } catch {
    throw new ResearchError('Selected host does not match its authorized scope');
  }
  if (legacyExclusions.some(rule => matchesHost(target.host, rule))) throw new ResearchError('Host is explicitly out of scope');
}

export function exportText(value: string): string {
  return redactObservationText(value)
    .replace(/\b(?:api.?key(?:cipher)?|\w+cipher|bearer|token|DATABASE_URL|REDIS_URL|AUTH_SECRET|CREDENTIALS_ENCRYPTION_KEY)\s*["']?\s*[:= ]\s*[^\r\n]+/gi, '[REDACTED]')
    .replace(/\b(?:sk|ghp|github_pat)[_-][a-zA-Z0-9_-]+/g, '[REDACTED]')
    .replace(/https?:\/\/[^\s<>"`]+/gi, url => safeObservationUrl(url))
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    .slice(0, 20000);
}

export function researchAuthorizationSnapshot(target: ResearchTarget) {
  return {
    targetId: target.id,
    host: target.host,
    scheme: target.scheme ?? 'https',
    ...((((target.scopeAsset ?? target.discoveredFromAsset)?.format === 'URL') || (target.scopeAsset && target.contextOnly))
      ? { assetId: (target.scopeAsset ?? target.discoveredFromAsset)!.id, assetBoundary: (target.scopeAsset ?? target.discoveredFromAsset)!.normalizedValue }
      : {}),
    scopeId: target.scope.id,
    programId: target.program!.id,
    scopeUpdatedAt: target.scope.updatedAt.toISOString(),
    programUpdatedAt: target.program!.updatedAt.toISOString(),
    requiredUserAgent: target.program!.requiredUserAgent,
  };
}

export function researchAuthorizationMatches(snapshot: unknown, target: ResearchTarget) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
  const current = researchAuthorizationSnapshot(target);
  const stored = snapshot as Record<string, unknown>;
  const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
      : item);
  return canonical(Object.fromEntries(Object.keys(current).map(key => [key, stored[key]]))) === canonical(current);
}
