import { join, resolve, isAbsolute } from "node:path";
import { safeObservationUrl, redactObservationText } from "@/lib/observationSafety";
import { matchesHost, normalizeFqdn } from "@/lib/bountyProgram";
import { requiredUserAgentSchema } from '@/lib/httpPolicy.mjs';
import { MISSING_HUNTER_UA } from '@/lib/programExecutionPolicy';
import { programPolicyInclude, resolveProgramPolicy } from '@/server/programExecutionPolicy';
import { scanRejection } from "@/server/execution";
import type { Prisma } from "@prisma/client";
import { assetAllowsHost } from '@/lib/scopeAssets';
import { assessmentSnapshotFromRun } from '@/lib/assessment';

// Explicit projection: no Prisma credential or AI secret can enter the exporter.
export const researchTargetSelect = {
  consoleDeletingAt:true,
  scopeAsset: { select: { id: true, programId: true, originalValue: true, normalizedValue: true, format: true, type: true, assetValue: true, active: true, updatedAt: true } },
  discoveredFromAsset: { select: { id: true, programId: true, originalValue: true, normalizedValue: true, format: true, type: true, assetValue: true, active: true, updatedAt: true } },
  id: true, userId: true, host: true, scheme: true, active: true, contextOnly: true, discoverySource: true,
  scope: { select: { updatedAt: true, id: true, userId: true, hostPattern: true, status: true, rulesOfEngagement: true, scopeDetails: true, outOfScope: true, disclosurePolicy: true, safeHarbor: true, legalTerms: true, eligibilityCriteria: true, reportingFormat: true } },
  program: { select: { ...programPolicyInclude, programUrl: true, updatedAt: true, id: true, ownerId: true, companyName: true, requiredUserAgent: true, scopeRules: true, rulesOfEngagement: true, deletingAt: true, outOfScope: true, qualifying: true, nonQualifying: true } },
  credentials: { select: { label: true, purpose: true, sessionStatus: true } },
} satisfies Prisma.TargetSelect;
type SelectedResearchTarget = Prisma.TargetGetPayload<{ select: typeof researchTargetSelect }>;
type SelectedProgram = NonNullable<SelectedResearchTarget['program']>;
type PolicyFields = 'programUrl' | 'executionPolicies';
export type ResearchTarget = Omit<SelectedResearchTarget, 'scopeAsset' | 'discoveredFromAsset' | 'consoleDeletingAt' | 'program'> &
  Partial<Pick<SelectedResearchTarget, 'scopeAsset' | 'discoveredFromAsset' | 'consoleDeletingAt'>> & {
    program: (Omit<SelectedProgram, PolicyFields> & Partial<Pick<SelectedProgram, PolicyFields>>) | null;
  };
export const researchUserAgent = (target: ResearchTarget) => resolveProgramPolicy(target.program!).userAgent;
export const researchIsPassive = (target: ResearchTarget) => target.scopeAsset ? target.scopeAsset.format === 'WILDCARD_DOMAIN' : target.contextOnly;
export type ResearchRecon = { id: string; reconCorpus: unknown } | null;
export type ResearchFinding = { id: string; title: string; severity: string; vulnClass: string | null; reviewStatus: string; location: string | null };
export class ResearchError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function assertResearchTarget(target: ResearchTarget, userId: string) {
  if (target.userId !== userId || target.scope.userId !== userId || target.program?.ownerId !== userId) throw new ResearchError("Target not found", 404);
  if (target.program?.deletingAt) throw new ResearchError('Target deletion is in progress', 409);
  if(target.consoleDeletingAt)throw new ResearchError('Console deletion in progress; retry Delete to complete cleanup',409);
  const boundary = target.scopeAsset ?? target.discoveredFromAsset;
  if (boundary && (!boundary.active || (target.scopeAsset?.format !== 'WILDCARD_DOMAIN' && !assetAllowsHost(boundary, target.host)))) throw new ResearchError('Scope asset authorization is no longer active', 409);
  const legacyExclusions = target.scope.outOfScope?.toLowerCase().match(/(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+/g) ?? [];
  if (boundary && legacyExclusions.some(rule => matchesHost(target.host, rule))) throw new ResearchError('Host is explicitly out of scope');
  if (!researchIsPassive(target) && !requiredUserAgentSchema.safeParse(researchUserAgent(target)).success) throw new ResearchError(MISSING_HUNTER_UA);
  if (target.scopeAsset) {
    if (target.scope.status !== 'APPROVED') throw new ResearchError('Scope is not approved');
    if (target.scopeAsset.format === 'WILDCARD_DOMAIN') return;
    const rejection = scanRejection(target, 'HOST', false); if (rejection) throw new ResearchError(rejection);
    return;
  }
  if (target.contextOnly) { if (target.scope.status !== "APPROVED") throw new ResearchError("Program scope is not approved"); return; }
  const rejection = scanRejection(target, 'HOST', false);
  if (rejection) throw new ResearchError(rejection);
  try { if (normalizeFqdn(target.host) !== target.host || !matchesHost(target.host, target.scope.hostPattern)) throw new Error(); }
  catch { throw new ResearchError("Selected host does not match its authorized scope"); }
  // Legacy free-text exclusions are authoritative too. Host-shaped entries in
  // prose are conservative denials; ambiguous prose must be reviewed by the user.
  if (legacyExclusions.some(rule => matchesHost(target.host, rule))) throw new ResearchError("Host is explicitly out of scope");
}

/** Free text is never trusted for credentials. No raw HTTP bodies, headers,
 * credential material, finding evidence or accessInfo is serialized. */
export function exportText(value: string): string {
  return redactObservationText(value)
    .replace(/\b(?:api.?key(?:cipher)?|\w+cipher|bearer|token|DATABASE_URL|REDIS_URL|AUTH_SECRET|CREDENTIALS_ENCRYPTION_KEY)\s*["']?\s*[:= ]\s*[^\r\n]+/gi, "[REDACTED]")
    .replace(/\b(?:sk|ghp|github_pat)[_-][a-zA-Z0-9_-]+/g, "[REDACTED]")
    .replace(/https?:\/\/[^\s<>"`]+/gi, url => safeObservationUrl(url))
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    .slice(0, 20000);
}
/** Immutable policy identity/version at export. No credentials or free text. */
export function researchAuthorizationSnapshot(target: ResearchTarget) {
  return { targetId: target.id, host: target.host, scheme: target.scheme ?? "https",
    ...((((target.scopeAsset ?? target.discoveredFromAsset)?.format === 'URL') || (target.scopeAsset && target.contextOnly)) ? { assetId: (target.scopeAsset ?? target.discoveredFromAsset)!.id, assetBoundary: (target.scopeAsset ?? target.discoveredFromAsset)!.normalizedValue } : {}),
    scopeId: target.scope.id, programId: target.program!.id,
    scopeUpdatedAt: target.scope.updatedAt.toISOString(), programUpdatedAt: target.program!.updatedAt.toISOString(),
    requiredUserAgent: target.program!.requiredUserAgent };
}
/** Compare network authorization only. Assessment metadata is immutable context,
 * and a later source/mode edit does not revoke an existing network policy. */
export function researchAuthorizationMatches(snapshot: unknown, target: ResearchTarget) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
  const current = researchAuthorizationSnapshot(target), stored = snapshot as Record<string, unknown>;
  const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  return canonical(Object.fromEntries(Object.keys(current).map(key => [key, stored[key]]))) === canonical(current);
}
export function researchAssessmentSnapshot(snapshot: unknown) {
  const stored = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot as Record<string, unknown> : {};
  const mode = stored.assessmentMode === 'BLACK_BOX' || stored.assessmentMode === 'WHITE_BOX' ? stored.assessmentMode : null;
  return assessmentSnapshotFromRun({ assessmentModeSnapshot: mode, assessmentSourcesSnapshot: stored.authorizedSources });
}
const workspacePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function workspacePath(root: string, workspaceId: string) {
  if (!isAbsolute(root) || !(workspacePattern.test(workspaceId) || /^research_[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(workspaceId))) throw new ResearchError("Invalid workspace identity");
  return join(resolve(root), workspaceId);
}
