import { redactObservationText, safeObservationUrl } from './observationSafety';

export const AUTH_CONTEXT_LIMIT = 4;
export const AUTH_DIFFERENTIAL_NOTICE = 'A context differential records observed visibility differences only. It does not demonstrate broken authorization. Manual Research is required.';
export type AuthContextEligibility = 'PLANNED' | 'SESSION_UNAVAILABLE' | 'AUTH_CONTEXT_LIMIT' | 'AUTH_CONTEXT_DUPLICATE_IDENTITY' | 'AUTH_CONTEXT_SCOPE_BLOCKED';
export type CapturedAuthContext = {
  credentialId: string; contextKey: string; label: string; purpose: string; persona: string | null;
  sessionIdentityHash: string | null; sessionCheckId: string | null; sessionStatus: string;
  checkedAt: string | null; expiresAt: string | null; validationUrl: string | null; ownedObjectUrl: string | null;
  validationSeedHash?: string | null; ownedObjectSeedHash?: string | null;
  eligibility: AuthContextEligibility;
};
export type AuthContextsSnapshot = { version: 1; anonymous: { contextKey: 'ANONYMOUS'; mode: 'ANONYMOUS' }; contextLimit: number; contexts: CapturedAuthContext[] };
export type AuthContextCoverage = { contextKey: string; state: string; reason?: string; failure?: import('./reconCapabilities').ReconFailure; requests?: number; pages?: number };
export type SafeAuthContext = { contextKey: string; mode: 'ANONYMOUS' | 'AUTHENTICATED'; label: string; purpose?: string; persona?: string | null; state: string; reason?: string; checkedAt?: string | null };
export type SurfaceObservation = {
  id?: string; contextKey: string; contextType: string; canonicalKey: string; url: string; method: string;
  statusCode: number | null; contentType: string | null; redirect: string | null; redirectPattern: string | null;
  responseClass: string; observedAt: string; source: string; urlRedacted?: boolean;
};
export type SurfaceClassification = 'PUBLIC' | 'SHARED_AUTHENTICATED' | 'AUTHENTICATED_ONLY' | 'CONTEXT_DIFFERENTIAL';
export type SurfaceVisibility = {
  url: string; method: string; canonicalKey: string; classification: SurfaceClassification | 'NOT_OBSERVED_IN_CONTEXT';
  classifications: SurfaceClassification[]; evidenceRefs: string[];
  visibility: { contextKey: string; label: string; outcome: string; observed: boolean; statusCode?: number; evidenceRefs: string[] }[];
};
export type SafeAuthSurface = {
  scanRunId: string; legacy: boolean; contexts: SafeAuthContext[]; observations: SurfaceObservation[];
  surfaceVisibility: SurfaceVisibility[]; totals: { public: number; authenticatedOnly: number; sharedAuthenticated: number; contextDifferentials: number; observations: number };
  warnings: string[]; truncated?: boolean;
};
/** Labels are operator-declared; strip common PII/credential-shaped text before exports. */
export function safeAuthLabel(value: unknown, fallback = 'Test context'): string {
  if (typeof value !== 'string') return fallback;
  const text = redactObservationText(value).replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted]').replace(/\b(?:gh[pousr]_|github_pat_|glpat-|sk-(?:or-v1-)?)[a-z0-9_-]{8,}/gi, '[redacted]').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 80);
  return text || fallback;
}
/** Stable redacted endpoint identity, never a request seed for reconstructed private URLs. */
export function safeSurfaceUrl(raw: string): string {
  const url = new URL(safeObservationUrl(raw));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported surface URL');
  const parts = url.pathname.split('/');
  url.pathname = parts.map((segment, index) => {
    let decoded: string; try { decoded = decodeURIComponent(segment); } catch { decoded = segment; }
    const identityPath = /^(?:users?|accounts?|profiles?|customers?|members?|tenants?)$/i.test(parts[index - 1] ?? '') && !/^(?:me|self|current|settings|search|list|count|new|all)$/i.test(decoded);
    return /@|\b(?:eyJ|ghp_|github_pat_|glpat-)/i.test(decoded) ? '[redacted]' : identityPath || /^\d{4,}$|^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(decoded) ? '[id]' : segment;
  }).join('/');
  const names = [...new Set([...url.searchParams.keys()])].sort(); url.search = ''; for (const name of names) url.searchParams.set(name, '');
  url.hash = ''; if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().slice(0, 4096);
}
export function authContextsSnapshot(value: unknown): AuthContextsSnapshot | null {
  if (!value || typeof value !== 'object' || (value as { version?: number }).version !== 1 || !Array.isArray((value as { contexts?: unknown }).contexts)) return null;
  return value as AuthContextsSnapshot;
}
export function safeAuthContexts(snapshot: AuthContextsSnapshot | null, coverage: AuthContextCoverage[] = []): SafeAuthContext[] {
  if (!snapshot) return [];
  return [{ contextKey: 'ANONYMOUS', mode: 'ANONYMOUS', label: 'Anonymous', state: coverage.find(c => c.contextKey === 'ANONYMOUS')?.state ?? 'NOT_OBSERVED' }, ...snapshot.contexts.map((context): SafeAuthContext => {
    const result = coverage.find(c => c.contextKey === context.contextKey);
    return { contextKey: context.contextKey, mode: 'AUTHENTICATED', label: safeAuthLabel(context.label), purpose: context.purpose, persona: context.persona ? safeAuthLabel(context.persona, 'Operator-declared') : null,
      state: result?.state ?? (context.eligibility === 'PLANNED' ? 'PLANNED' : context.eligibility === 'SESSION_UNAVAILABLE' ? 'SKIPPED_SESSION_UNAVAILABLE' : context.eligibility), ...(result?.reason ? { reason: safeAuthLabel(result.reason, 'Coverage unavailable') } : {}), checkedAt: context.checkedAt };
  })];
}
export function deriveSurfaceVisibility(contexts: SafeAuthContext[], observations: SurfaceObservation[]): SurfaceVisibility[] {
  const groups = new Map<string, SurfaceObservation[]>();
  for (const observation of observations) { const key = observation.canonicalKey; groups.set(key, [...groups.get(key) ?? [], observation]); }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([canonicalKey, records]) => {
    const byContext = new Map(records.map(row => [row.contextKey, row]));
    const visible = (row?: SurfaceObservation) => row?.responseClass === 'CONTENT' && Boolean(row.statusCode && row.statusCode >= 200 && row.statusCode < 400);
    const auth = contexts.filter(c => c.mode === 'AUTHENTICATED' && !['AUTH_CONTEXT_DUPLICATE_IDENTITY', 'AUTH_CONTEXT_LIMIT', 'SKIPPED_SESSION_UNAVAILABLE', 'AUTH_CONTEXT_SCOPE_BLOCKED'].includes(c.state));
    const visibleAuth = auth.filter(context => visible(byContext.get(context.contextKey)));
    const classifications: SurfaceClassification[] = [];
    if (visible(byContext.get('ANONYMOUS'))) classifications.push('PUBLIC');
    if (visibleAuth.length && !visible(byContext.get('ANONYMOUS')) && byContext.get('ANONYMOUS') && byContext.get('ANONYMOUS')!.responseClass !== 'UNAVAILABLE') classifications.push('AUTHENTICATED_ONLY');
    if (visibleAuth.length > 1) classifications.push('SHARED_AUTHENTICATED');
    // A missing/failed request is not a denial. Every participating identity
    // must have a concrete response before declaring a visibility differential.
    const comparable = auth.length > 1 && auth.every(context => { const row = byContext.get(context.contextKey); return row && row.responseClass !== 'UNAVAILABLE'; });
    if (comparable && visibleAuth.length > 0 && visibleAuth.length < auth.length) classifications.push('CONTEXT_DIFFERENTIAL');
    const classification = classifications.includes('CONTEXT_DIFFERENTIAL') ? 'CONTEXT_DIFFERENTIAL' : classifications.includes('PUBLIC') ? 'PUBLIC' : classifications.includes('AUTHENTICATED_ONLY') ? 'AUTHENTICATED_ONLY' : classifications.includes('SHARED_AUTHENTICATED') ? 'SHARED_AUTHENTICATED' : 'NOT_OBSERVED_IN_CONTEXT';
    return { canonicalKey, url: records[0].url, method: records[0].method, classification, classifications, evidenceRefs: [...new Set(records.flatMap(row => row.id ? [row.id] : []))].sort(), visibility: contexts.map(context => {
      const row = byContext.get(context.contextKey);
      return { contextKey: context.contextKey, label: context.label, outcome: row ? row.responseClass : 'NOT_OBSERVED_IN_CONTEXT', observed: Boolean(row && row.responseClass !== 'UNAVAILABLE'), ...(row?.statusCode ? { statusCode: row.statusCode } : {}), evidenceRefs: row?.id ? [row.id] : [] };
    }) };
  });
}
