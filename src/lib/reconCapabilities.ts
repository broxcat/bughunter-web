/** Methodology v2: objectives are evaluated separately from provider exit codes. */
export const RECON_CAPABILITIES = [
  'AUTHORIZATION', 'PASSIVE_SUBDOMAIN_DISCOVERY', 'ACTIVE_DNS_DISCOVERY',
  'DNS_RESOLUTION', 'HTTP_DISCOVERY', 'PORT_DISCOVERY',
  'TECHNOLOGY_FINGERPRINTING', 'CONTENT_CALIBRATION', 'CONTENT_DISCOVERY',
  'CRAWLING', 'ENTRY_POINT_MAPPING', 'API_MAPPING', 'AUTH_MAPPING',
  'AUTHENTICATED_MAPPING',
  'TLS_MAPPING', 'SURFACE_TEMPLATE_MATCHING',
  'NORMALIZATION', 'ATTACK_SURFACE_INTELLIGENCE',
] as const;
export type ReconCapability = typeof RECON_CAPABILITIES[number];
export type ReconCapabilityStatus = 'COMPLETED' | 'COMPLETED_WITH_FALLBACK' | 'PARTIAL' | 'BLOCKED' |
  'SKIPPED_NOT_APPLICABLE' | 'SKIPPED_UNSUPPORTED' | 'FAILED' | 'CANCELLED';
export type ReconFailureReason = 'MISSING_TOOL' | 'INCOMPATIBLE_TOOL' | 'MISSING_WORDLIST' |
  'MISSING_TEMPLATE' | 'SOFT_404' | 'WILDCARD_REDIRECT' | 'NON_DISCRIMINATING_WILDCARD_RESPONSE' |
  'RATE_LIMITED' | 'WAF_BLOCKED' | 'DNS_FAILURE' | 'TIMEOUT' | 'NETWORK_UNREACHABLE' |
  'SCOPE_BLOCKED' | 'PARSER_FAILURE' | 'TOOL_EXIT_ERROR' | 'RESOURCE_LIMIT' | 'CANCELLED' |
  'TEMPORARY_UPSTREAM' | 'WORKER_LEASE_LOST' | 'INVALID_TARGET' |
  'SESSION_UNAVAILABLE' | 'SESSION_EXPIRED' | 'SESSION_LOST' | 'AUTH_CONTEXT_LIMIT' |
  'AUTH_CONTEXT_DUPLICATE_IDENTITY' | 'AUTH_RELAY_FAILURE' | 'AUTH_CONTEXT_SCOPE_BLOCKED' | 'INTERNAL_AUTH_RECON_FAILURE';
export type CoverageImpact = 'NONE' | 'REDUCED' | 'BLOCKED';
export type ReconFailure = {
  reason: ReconFailureReason;
  category: 'ENVIRONMENT' | 'TOOL' | 'TARGET' | 'EXPECTED_BEHAVIOR' | 'POLICY';
  retryable: boolean;
  coverageImpact: CoverageImpact;
  fallbackUsed: boolean;
  tool?: string;
  capability: ReconCapability;
  message: string;
};
export type ReconCapabilityPlan = {
  id: ReconCapability;
  stage: string;
  required: boolean;
  enabled: boolean;
  mode: 'PASSIVE' | 'ACTIVE';
  providers: string[];
  /** Several passive sources can satisfy one objective; additional sources enrich it. */
  minSuccessfulProviders: number;
  /** Provider completion must satisfy this objective; exit 0 alone never suffices. */
  coverageObjective: string;
  reason: string;
};
export type ReconProviderAttempt = {
  provider: string;
  state: ReconCapabilityStatus;
  coverageSatisfied: boolean;
  artifactsProduced: number;
  durationMs: number;
  failure?: ReconFailure;
  fallback?: boolean;
  coverageBasis?: 'CALIBRATED_ENUMERATION' | 'OBSERVED_LINKS' | 'VALIDATED_PROVIDER_OUTPUT' | 'DOCUMENTED_EMPTY_RESULT';
};
export type ReconCapabilityResult = {
  capability: ReconCapability;
  state: ReconCapabilityStatus;
  required: boolean;
  providersAttempted: ReconProviderAttempt[];
  providersSelected: string[];
  fallbacks: string[];
  artifactsProduced: number;
  durationMs: number;
  coverageImpact: CoverageImpact;
  reason: string;
};

const environment = new Set<ReconFailureReason>(['MISSING_TOOL', 'MISSING_WORDLIST', 'MISSING_TEMPLATE', 'RESOURCE_LIMIT', 'AUTH_RELAY_FAILURE', 'INTERNAL_AUTH_RECON_FAILURE']);
const incompatible = new Set<ReconFailureReason>(['INCOMPATIBLE_TOOL', 'PARSER_FAILURE', 'TOOL_EXIT_ERROR']);
const behavior = new Set<ReconFailureReason>(['SOFT_404', 'WILDCARD_REDIRECT', 'NON_DISCRIMINATING_WILDCARD_RESPONSE', 'SESSION_UNAVAILABLE', 'SESSION_EXPIRED', 'SESSION_LOST', 'AUTH_CONTEXT_LIMIT', 'AUTH_CONTEXT_DUPLICATE_IDENTITY']);
export function reconFailure(reason: ReconFailureReason, options: {
  capability: ReconCapability; tool?: string; message?: string; transient?: boolean;
  coverageImpact?: CoverageImpact; fallbackUsed?: boolean;
}): ReconFailure {
  const category = environment.has(reason) ? 'ENVIRONMENT' : incompatible.has(reason) ? 'TOOL' :
    behavior.has(reason) ? 'EXPECTED_BEHAVIOR' : ['SCOPE_BLOCKED', 'AUTH_CONTEXT_SCOPE_BLOCKED', 'INVALID_TARGET', 'CANCELLED'].includes(reason) ? 'POLICY' : 'TARGET';
  const retryable = ['TIMEOUT', 'TEMPORARY_UPSTREAM', 'WORKER_LEASE_LOST'].includes(reason) ||
    options.transient === true && ['DNS_FAILURE', 'NETWORK_UNREACHABLE'].includes(reason);
  return { reason, category, retryable, coverageImpact: options.coverageImpact ?? 'REDUCED',
    fallbackUsed: options.fallbackUsed ?? false, tool: options.tool ?? 'internal', capability: options.capability,
    message: (options.message ?? reason).replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 500) };
}

/** No retry changes scope or permits replay after a lost execution lease. The
 * caller must still own the lease and retry only a safe bounded operation. */
export function reconRetryDelay(failure: ReconFailure, attempt: number): number | null {
  if (!failure.retryable || !Number.isInteger(attempt) || attempt < 0 || attempt >= 2) return null;
  return Math.min(2000, 250 * 2 ** attempt);
}

export function classifyReconFailure(error: unknown, capability: ReconCapability, tool?: string): ReconFailure {
  if (typeof error === 'object' && error && 'reason' in error && 'retryable' in error) return error as ReconFailure;
  const message = error instanceof Error ? error.message : String(error);
  let reason: ReconFailureReason = 'TOOL_EXIT_ERROR', transient = false;
  if (error instanceof Error && error.name === 'TimeoutError') reason = 'TIMEOUT';
  else if (/AUTH_CONTEXT_SESSION_UNAVAILABLE|\bSESSION_UNAVAILABLE\b/.test(message)) reason = 'SESSION_UNAVAILABLE';
  else if (/\bSESSION_EXPIRED\b/.test(message)) reason = 'SESSION_EXPIRED';
  else if (/AUTH_CONTEXT_SESSION_LOST|\bSESSION_LOST\b/.test(message)) reason = 'SESSION_LOST';
  else if (/AUTH_CONTEXT_DUPLICATE_IDENTITY/.test(message)) reason = 'AUTH_CONTEXT_DUPLICATE_IDENTITY';
  else if (/AUTH_CONTEXT_LIMIT/.test(message)) reason = 'AUTH_CONTEXT_LIMIT';
  else if (/AUTH_CONTEXT_SCOPE_BLOCKED/.test(message)) reason = 'AUTH_CONTEXT_SCOPE_BLOCKED';
  else if (/AUTH_RELAY_FAILURE/.test(message)) reason = 'AUTH_RELAY_FAILURE';
  else if (/INTERNAL_AUTH_RECON_FAILURE/.test(message)) reason = 'INTERNAL_AUTH_RECON_FAILURE';
  else if (/scope|authorization|out.of.scope/i.test(message)) reason = 'SCOPE_BLOCKED';
  else if (/cancel|abort/i.test(message)) reason = 'CANCELLED';
  else if (/missing.*wordlist|wordlist.*(?:missing|unavailable|ENOENT)/i.test(message)) reason = 'MISSING_WORDLIST';
  else if (/missing.*template|template.*(?:missing|unavailable|ENOENT)/i.test(message)) reason = 'MISSING_TEMPLATE';
  else if (/missing.tool|binary.*(?:unavailable|missing)|spawn.*ENOENT/i.test(message)) reason = 'MISSING_TOOL';
  else if (/unsupported.flag|unknown.flag|incompatible|audited.*(?:flags|toolchain)/i.test(message)) reason = 'INCOMPATIBLE_TOOL';
  else if (/429|rate.limit|too many requests/i.test(message)) reason = 'RATE_LIMITED';
  else if (/403|captcha|waf|access.denied/i.test(message)) reason = 'WAF_BLOCKED';
  else if (/soft.?404/i.test(message)) reason = 'SOFT_404';
  else if (/wildcard.*redirect/i.test(message)) reason = 'WILDCARD_REDIRECT';
  else if (/timeout|timed.out|ETIMEDOUT/i.test(message)) reason = 'TIMEOUT';
  else if (/EAI_AGAIN|ESERVFAIL|\bSERVFAIL\b|temporary.*DNS/i.test(message)) { reason = 'DNS_FAILURE'; transient = true; }
  else if (/ENOTFOUND|NXDOMAIN|DNS|resolv/i.test(message)) reason = 'DNS_FAILURE';
  else if (/ECONNRESET|connection.reset/i.test(message)) { reason = 'NETWORK_UNREACHABLE'; transient = true; }
  else if (/ENETUNREACH|ECONNREFUSED|network|fetch.failed/i.test(message)) reason = 'NETWORK_UNREACHABLE';
  else if (/50[0234]|temporary.*upstream/i.test(message)) reason = 'TEMPORARY_UPSTREAM';
  else if (/parser|malformed|invalid.json/i.test(message)) reason = 'PARSER_FAILURE';
  else if (/budget|limit|capacity|ENOSPC|EMFILE/i.test(message)) reason = 'RESOURCE_LIMIT';
  return reconFailure(reason, { capability, tool, message, transient });
}

export function evaluateCapability(plan: ReconCapabilityPlan, attempts: ReconProviderAttempt[]): ReconCapabilityResult {
  const successful = [...new Set(attempts.filter(a => plan.providers.includes(a.provider) && a.coverageSatisfied &&
    (plan.id !== 'CONTENT_DISCOVERY' || a.provider !== 'bounded-crawler' || a.coverageBasis === 'CALIBRATED_ENUMERATION') &&
    ['COMPLETED', 'COMPLETED_WITH_FALLBACK'].includes(a.state)).map(a => a.provider))];
  const selected = successful.slice(0, Math.max(1, plan.minSuccessfulProviders));
  const completed = selected.length >= Math.max(1, plan.minSuccessfulProviders);
  const first = plan.providers[0];
  const fallbacks = selected.filter(provider => provider !== first &&
    (!successful.includes(first) || attempts.some(a => a.provider === provider && a.fallback)));
  let state: ReconCapabilityStatus, reason: string;
  if (!plan.enabled) { state = 'SKIPPED_NOT_APPLICABLE'; reason = plan.reason; }
  else if (attempts.some(a => a.state === 'CANCELLED')) { state = 'CANCELLED'; reason = 'Authorization revoked or execution cancelled.'; }
  else if (completed) {
    state = fallbacks.length ? 'COMPLETED_WITH_FALLBACK' : 'COMPLETED';
    reason = `Coverage objective satisfied by ${selected.join(', ')}. ` +
      (fallbacks.length ? 'Fallback used; unsuitable provider failures do not reduce obtained coverage.' : 'Additional provider results are enrichment.');
  } else if (attempts.some(a => a.state === 'BLOCKED')) { state = 'BLOCKED'; reason = 'Target blocking or rate limiting prevented the coverage objective.'; }
  else if (successful.length > 0 || attempts.some(a => plan.providers.includes(a.provider) && (a.artifactsProduced > 0 || a.state === 'PARTIAL'))) {
    state = 'PARTIAL'; reason = 'Some evidence was retained, but the minimum coverage objective was not satisfied.';
  } else if (attempts.length && attempts.every(a => a.state === 'SKIPPED_NOT_APPLICABLE')) {
    // A provider being unsuitable does not waive a required coverage objective.
    // Optional objectives such as TLS on HTTP-only services are truly inapplicable.
    state = plan.required ? 'PARTIAL' : 'SKIPPED_NOT_APPLICABLE';
    reason = plan.required ? 'The required coverage objective remains unmet; every attempted provider was unsuitable.' :
      'This enrichment objective does not apply to the observed services.';
  } else if (attempts.length && attempts.every(a => a.state === 'SKIPPED_UNSUPPORTED' || a.state === 'SKIPPED_NOT_APPLICABLE')) {
    state = 'SKIPPED_UNSUPPORTED'; reason = 'No compatible provider was available for this objective.';
  } else { state = 'FAILED'; reason = 'No provider demonstrated the minimum coverage objective; empty output is not proof of absence.'; }
  return { capability: plan.id, state, required: plan.required, providersAttempted: attempts,
    providersSelected: selected, fallbacks,
    artifactsProduced: attempts.reduce((n, a) => n + Math.max(0, a.artifactsProduced), 0),
    durationMs: attempts.reduce((n, a) => n + Math.max(0, a.durationMs), 0),
    coverageImpact: !plan.required || !plan.enabled || completed ? 'NONE' : state === 'PARTIAL' ? 'REDUCED' : 'BLOCKED', reason };
}

export function requiredCoverageSatisfied(results: ReconCapabilityResult[]) {
  const required = results.filter(r => r.required);
  return required.length > 0 && required.every(r => ['COMPLETED', 'COMPLETED_WITH_FALLBACK', 'SKIPPED_NOT_APPLICABLE'].includes(r.state));
}

export function buildCapabilityPlans(input: {
  wildcard: boolean; active: boolean; assetActive: boolean; httpOnly: boolean;
  type: string; depth: 'LIGHT' | 'STANDARD' | 'DEEP'; gobusterDir: boolean; gobusterDns: boolean;
  authenticatedContexts?: number;
}): ReconCapabilityPlan[] {
  const web = input.httpOnly || ['WEB_APPLICATION', 'API', 'WILDCARD'].includes(input.type);
  const authenticated = Boolean(input.authenticatedContexts) && !input.wildcard;
  const contentProviders = input.gobusterDir && input.depth === 'LIGHT' ? ['gobuster', 'ffuf', 'bounded-crawler'] :
    ['ffuf', ...(input.gobusterDir ? ['gobuster'] : []), 'bounded-crawler'];
  const add = (id: ReconCapability, stage: string, providers: string[], required: boolean, enabled: boolean,
    mode: 'PASSIVE' | 'ACTIVE', coverageObjective: string, minSuccessfulProviders = 1): ReconCapabilityPlan => ({
      id, stage, providers, required, enabled, mode, coverageObjective, minSuccessfulProviders,
      reason: enabled ? `${coverageObjective}; providers may substitute without expanding scope.` : 'Not applicable to the selected format or effective authorization.',
    });
  return [
    add('AUTHORIZATION', 'Preflight', ['scope-engine'], true, input.assetActive, 'PASSIVE', 'Current scope authorization and execution prerequisites validated'),
    add('PASSIVE_SUBDOMAIN_DISCOVERY', 'Passive discovery', ['subfinder', 'amass', 'assetfinder'], input.wildcard, input.wildcard && input.assetActive, 'PASSIVE', 'At least two independently completed passive discovery sources', 2),
    add('ACTIVE_DNS_DISCOVERY', 'Scope validation / DNS', ['gobuster'], false, input.gobusterDns, 'ACTIVE', 'Bounded descendant-only DNS expansion'),
    add('DNS_RESOLUTION', 'Scope validation / DNS', ['native-dns'], input.active, input.active, 'ACTIVE', 'Authorized host resolution with address/CNAME provenance'),
    add('HTTP_DISCOVERY', 'HTTP surface', ['httpx', 'guarded-http'], input.active && (web||authenticated), input.active, 'ACTIVE', 'Authorized HTTP availability mapped with verified responses'),
    add('TECHNOLOGY_FINGERPRINTING', 'Web / API mapping', ['native-fingerprint', 'httpx'], false, input.active, 'ACTIVE', 'Evidence-backed technology signatures without invented versions'),
    add('TLS_MAPPING', 'Web / API mapping', ['native-tls'], false, input.active, 'ACTIVE', 'Transport/certificate observations on selected HTTPS services'),
    add('PORT_DISCOVERY', 'Ports / services', ['guarded-tcp'], input.active && !web, input.active && !input.httpOnly, 'ACTIVE', 'Bounded authorized host service inventory'),
    add('CONTENT_CALIBRATION', 'Content discovery', ['guarded-http'], input.active && web, input.active, 'ACTIVE', 'At least three controlled unknown-path responses or explicit blocking limitation'),
    add('CONTENT_DISCOVERY', 'Content discovery', contentProviders, input.active && web, input.active, 'ACTIVE', 'Bounded calibrated directory enumeration; observed-link crawl alone is insufficient'),
    add('CRAWLING', 'Web / API mapping', ['bounded-crawler'], false, input.active, 'ACTIVE', 'Bounded observation-only traversal of authorized safe links'),
    add('ENTRY_POINT_MAPPING', 'Web / API mapping', ['bounded-crawler'], input.active && web, input.active, 'ACTIVE', 'Analyzed entry-page/link/form inventory without submitting forms'),
    add('API_MAPPING', 'Web / API mapping', ['bounded-crawler'], false, input.active, 'ACTIVE', 'Observable specifications, API paths, methods and parameters'),
    add('AUTH_MAPPING', 'Web / API mapping', ['bounded-crawler'], false, input.active, 'ACTIVE', 'Observable authentication routes/challenges; no bypass/exploitation'),
    add('AUTHENTICATED_MAPPING', 'Web / API mapping', ['guarded-auth-mapper'], authenticated, input.active && authenticated, 'ACTIVE', 'Bounded read-only mapping of explicitly captured verified contexts; no login or scanner credential arguments'),
    add('SURFACE_TEMPLATE_MATCHING', 'Nuclei Recon', ['nuclei'], false, input.active, 'ACTIVE', 'Only the pinned allowlisted surface-mapping templates'),
    add('NORMALIZATION', 'Normalization', ['artifact-normalizer'], true, true, 'PASSIVE', 'Validated structured artifacts, scope states, deduplication and provenance'),
    add('ATTACK_SURFACE_INTELLIGENCE', 'Scope intelligence', ['internal'], true, true, 'PASSIVE', 'Evidence-backed relationships, coverage gaps and manual Research handoff'),
  ];
}
