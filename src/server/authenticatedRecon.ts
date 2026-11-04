import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { privateReferenceFingerprint } from '@/lib/crypto';
import { sessionState } from '@/lib/targetAuth';
import { assetAllowsUrl } from '@/lib/scopeAssets';
import { isSafeReadUrl } from '@/lib/observationSafety';
import { AUTH_CONTEXT_LIMIT, AUTH_DIFFERENTIAL_NOTICE, authContextsSnapshot, deriveSurfaceVisibility, safeAuthContexts, safeAuthLabel, safeSurfaceUrl, type AuthContextsSnapshot, type AuthContextCoverage, type CapturedAuthContext, type SafeAuthSurface } from '@/lib/authenticatedRecon';
import { decodeTargetCredential } from './credentials';
import { currentTargetExecution, assertExecutionUrl } from './execution';
import { throwIfScanAborted } from './scanControl';
import type { ProbeResult } from './scanners/http';

const contextKey = (targetId: string, id: string) => 'AUTH_' + createHash('sha256').update(targetId + ':' + id).digest('hex').slice(0, 24);
/** Called inside the run-creation transaction; locks prevent a torn credential
 * verification/edit snapshot. Never select or decrypt authentication material. */
export async function captureAuthenticatedContexts(tx: Prisma.TransactionClient, targetId: string): Promise<AuthContextsSnapshot> {
  const target = await tx.target.findUniqueOrThrow({ where: { id: targetId }, select: { host: true, contextOnly: true, scopeAsset: { select: { format: true, normalizedValue: true, active: true } } } });
  await tx.$queryRaw`SELECT id FROM "TargetCredential" WHERE "targetId"=${targetId} AND "reconEnabled"=true ORDER BY id FOR SHARE`;
  const rows = await tx.targetCredential.findMany({ where: { targetId, reconEnabled: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, label: true, purpose: true, persona: true, sessionStatus: true, sessionCheckedAt: true, sessionExpiresAt: true, sessionCheckId: true, sessionIdentityHash: true, validationUrl: true, ownedObjectUrl: true } });
  const snapshot: AuthContextsSnapshot = { version: 1, anonymous: { contextKey: 'ANONYMOUS', mode: 'ANONYMOUS' }, contextLimit: AUTH_CONTEXT_LIMIT, contexts: [] };
  const identities = new Set<string>(); let planned = 0;
  for (const row of rows) {
    const status = sessionState(row), wildcard = target.scopeAsset?.format === 'WILDCARD_DOMAIN' || target.host.startsWith('*.') || target.contextOnly;
    const eligibility: CapturedAuthContext['eligibility'] = wildcard ? 'AUTH_CONTEXT_SCOPE_BLOCKED' : status !== 'VALID' ? 'SESSION_UNAVAILABLE' : row.sessionIdentityHash && identities.has(row.sessionIdentityHash) ? 'AUTH_CONTEXT_DUPLICATE_IDENTITY' : planned >= AUTH_CONTEXT_LIMIT ? 'AUTH_CONTEXT_LIMIT' : 'PLANNED';
    if (eligibility === 'PLANNED') { planned++; if (row.sessionIdentityHash) identities.add(row.sessionIdentityHash); }
    const seed = (raw: string | null) => { if (!raw) return null; try { const url = new URL(raw); const expected = target.scopeAsset?.format === 'URL' ? new URL(target.scopeAsset.normalizedValue).host : target.host; return url.host === expected && !url.username && !url.password && isSafeReadUrl(raw) && (!target.scopeAsset || assetAllowsUrl(target.scopeAsset, raw)) ? raw : null; } catch { return null; } };
    // Only safe read seed metadata, no query values or userinfo. The live loader
    // retains the original private seed in memory if the redacted form differs.
    const validation = seed(row.validationUrl), owned = seed(row.ownedObjectUrl);
    snapshot.contexts.push({ credentialId: row.id, contextKey: contextKey(targetId, row.id), label: safeAuthLabel(row.label, 'Account ' + (snapshot.contexts.length + 1)), purpose: row.purpose, persona: row.persona ? safeAuthLabel(row.persona, 'Operator-declared') : null,
      sessionIdentityHash: row.sessionIdentityHash, sessionCheckId: row.sessionCheckId, sessionStatus: status, checkedAt: row.sessionCheckedAt?.toISOString() ?? null, expiresAt: row.sessionExpiresAt?.toISOString() ?? null,
      validationUrl: validation ? safeSurfaceUrl(validation) : null, ownedObjectUrl: owned ? safeSurfaceUrl(owned) : null,
      validationSeedHash: validation ? privateReferenceFingerprint('recon-auth-seed:' + row.id, validation) : null,
      ownedObjectSeedHash: owned ? privateReferenceFingerprint('recon-auth-seed:' + row.id, owned) : null, eligibility });
  }
  return snapshot;
}
/** Exact Target + origin + captured verification. Scans never decrypt login
 * inputs and never call the explicit connection/login workflow. */
export async function loadReconCredential(targetId: string, captured: CapturedAuthContext, url: string) {
  if (captured.eligibility !== 'PLANNED') return null;
  const execution = currentTargetExecution(); if (execution.targetId !== targetId || execution.programReconId) return null;
  try { assertExecutionUrl(url, execution); if (!isSafeReadUrl(url)) return null; } catch { return null; }
  const target = await prisma.target.findUnique({ where: { id: targetId }, select: { host: true, scheme: true, scopeAsset: { select: { normalizedValue: true, format: true, active: true } }, program: { select: { deletingAt: true } } } });
  if (!target || target.program?.deletingAt || target.scopeAsset?.active === false || target.scopeAsset?.format === 'WILDCARD_DOMAIN') return null;
  const origin = target.scopeAsset?.format === 'URL' ? new URL(target.scopeAsset.normalizedValue).origin : `${target.scheme === 'http' ? 'http' : 'https'}://${target.host}`;
  if (new URL(url).origin !== origin || target.scopeAsset && !assetAllowsUrl(target.scopeAsset, url)) return null;
  const row = await prisma.targetCredential.findFirst({ where: { id: captured.credentialId, targetId, reconEnabled: true }, select: { id: true, label: true, mode: true, purpose: true, ownedObjectUrl: true, validationUrl: true, sessionIdentityHash: true, sessionCheckId: true, sessionCheckedAt: true, sessionExpiresAt: true, sessionStatus: true, cookiesCipher: true, headerCipher: true, sessionCookiesCipher: true } });
  if (!row || sessionState(row) !== 'VALID' || row.sessionCheckId !== captured.sessionCheckId || (row.sessionCheckedAt?.toISOString() ?? null) !== captured.checkedAt || row.sessionIdentityHash !== captured.sessionIdentityHash) return null;
  const decoded = decodeTargetCredential(row);
  if (!decoded) return null;
  // Live storage supplies private seed values only in memory. A metadata edit
  // cannot silently replace the URL selected by this immutable run snapshot.
  const capturedSeed = (raw: string | null | undefined, safe: string | null, hash: string | null | undefined) => {
    if (!raw || !safe) return null;
    return hash ? privateReferenceFingerprint('recon-auth-seed:' + row.id, raw) === hash ? raw : null : safeSurfaceUrl(raw) === safe ? raw : null;
  };
  return { ...decoded, validationUrl: capturedSeed(decoded.validationUrl, captured.validationUrl, captured.validationSeedHash), ownedObjectUrl: capturedSeed(decoded.ownedObjectUrl, captured.ownedObjectUrl, captured.ownedObjectSeedHash) };
}

/** Hash only response structure, never retain response values, PII or tokens. */
export function safeSurfaceBodyHash(body: string, contentType = '') {
  let normalized: string;
  if (/json/i.test(contentType)) { try { const shape = (value: unknown, depth = 0): unknown => depth > 8 ? 'nested' : Array.isArray(value) ? value.slice(0, 20).map(item => shape(item, depth + 1)) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().slice(0, 100).map(key => [key, shape((value as Record<string, unknown>)[key], depth + 1)])) : value === null ? 'null' : typeof value; normalized = JSON.stringify(shape(JSON.parse(body))); } catch { normalized = 'unparsed-json'; } }
  else normalized = [...body.matchAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi)].slice(0, 2000).map(match => match[0].startsWith('</') ? '</' + match[1].toLowerCase() + '>' : '<' + match[1].toLowerCase() + '>').join('');
  return createHash('sha256').update(normalized).digest('hex');
}
export function surfaceResponseClass(page: ProbeResult & { bodyAvailable?: boolean }, contextType: 'ANONYMOUS' | 'AUTHENTICATED' = 'AUTHENTICATED') {
  if (page.error || !page.status) return 'UNAVAILABLE';
  const loginPage = /\/(?:login|signin|sign-in)(?:\/|$)/i.test(new URL(page.url).pathname);
  const loginForm = page.bodyAvailable !== false && /<input[^>]*type\s*=\s*["']?password/i.test(page.body) && (loginPage || /<form[^>]*action\s*=\s*["'][^"']*\/(?:login|signin|sign-in)(?:[/?#"'])/i.test(page.body) || /<(?:title|h[12])\b[^>]*>\s*(?:log\s*in|sign\s*in)\b/i.test(page.body));
  if (page.status >= 300 && page.status < 400 && /login|signin|sign-in/i.test(page.headers.location ?? '') || loginForm && !(contextType === 'ANONYMOUS' && loginPage)) return 'LOGIN_REDIRECT';
  return [401, 403, 404, 410].includes(page.status) ? 'DENIED' : page.status >= 200 && page.status < 400 ? 'CONTENT' : 'UNAVAILABLE';
}
export async function recordSurfaceObservation(scanRunId: string, scopeAssetId: string, context: Pick<CapturedAuthContext, 'contextKey'> | 'ANONYMOUS', page: ProbeResult & { bodyAvailable?: boolean }, source = 'native') {
  throwIfScanAborted();
  const key = typeof context === 'string' ? context : context.contextKey;
  const run = await prisma.scanRun.findUnique({ where: { id: scanRunId }, select: { targetId: true, scopeAssetId: true, authenticatedContextsSnapshot: true } });
  const snapshot = authContextsSnapshot(run?.authenticatedContextsSnapshot); if (!run || !snapshot || run.scopeAssetId !== scopeAssetId) return null;
  if (key !== 'ANONYMOUS' && !snapshot.contexts.some(c => c.contextKey === key && c.eligibility === 'PLANNED')) throw new Error('AUTH_CONTEXT_SCOPE_BLOCKED');
  const execution = currentTargetExecution(); assertExecutionUrl(page.url, execution);
  if (key !== 'ANONYMOUS' && run.targetId !== execution.targetId) throw new Error('AUTH_CONTEXT_SCOPE_BLOCKED');
  if (!['GET', 'HEAD'].includes(page.method) || !isSafeReadUrl(page.url)) return null;
  const url = safeSurfaceUrl(page.url), identity = new URL(page.url); identity.hash = ''; identity.searchParams.sort();
  const canonicalKey = page.method + ':' + privateReferenceFingerprint('recon-surface:' + scopeAssetId, identity.toString());
  const redirect = page.headers.location ? (() => { try { return safeSurfaceUrl(new URL(page.headers.location, page.url).toString()); } catch { return null; } })() : null;
  const mime = (page.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  const contentType = /^(?:text\/(?:html|plain|css|javascript|xml)|application\/(?:json|xml|javascript|graphql-response\+json|problem\+json|octet-stream)|image\/(?:png|jpeg|gif|svg\+xml|webp))$/.test(mime) ? mime : mime ? 'other/unknown' : null;
  const data = { contextType: key === 'ANONYMOUS' ? 'ANONYMOUS' : 'AUTHENTICATED', url, urlRedacted: url !== identity.toString(), method: page.method, statusCode: page.status > 0 ? page.status : null, contentType, redirect, redirectPattern: redirect, ...(page.bodyAvailable === false ? {} : { bodyHash: safeSurfaceBodyHash(page.body, contentType ?? ''), bodyLength: page.bodyLen }), responseClass: surfaceResponseClass(page, key === 'ANONYMOUS' ? 'ANONYMOUS' : 'AUTHENTICATED'), source: source.replace(/[^a-z0-9_.-]/gi, '').slice(0, 50), observedAt: new Date() };
  return prisma.reconSurfaceObservation.upsert({ where: { scanRunId_contextKey_canonicalKey: { scanRunId, contextKey: key, canonicalKey } }, create: { scanRunId, scopeAssetId, contextKey: key, canonicalKey, ...data }, update: data });
}

/** Explicit safe projection shared by Summary/Markdown/Research, including tx use. */
export async function readAuthSurface(runIds: string[], db: Pick<Prisma.TransactionClient, 'scanRun' | 'reconSurfaceObservation'> = prisma): Promise<SafeAuthSurface[]> {
  if (!runIds.length) return [];
  const runs = await db.scanRun.findMany({ where: { id: { in: runIds } }, select: { id: true, status: true, authenticatedContextsSnapshot: true, authenticatedReconResult: true } });
  const rows = await db.reconSurfaceObservation.findMany({ where: { scanRunId: { in: runIds } }, orderBy: [{ observedAt: 'asc' }, { id: 'asc' }], take: 2000, select: { id: true, scanRunId: true, contextKey: true, contextType: true, canonicalKey: true, url: true, urlRedacted: true, method: true, statusCode: true, contentType: true, redirect: true, redirectPattern: true, responseClass: true, observedAt: true, source: true } });
  return runs.map(run => {
    const snapshot = authContextsSnapshot(run.authenticatedContextsSnapshot), result = run.authenticatedReconResult as { contexts?: AuthContextCoverage[]; warnings?: string[] } | null;
    const contexts = safeAuthContexts(snapshot, result?.contexts ?? []), observations = rows.filter(row => row.scanRunId === run.id).map(({ scanRunId: _run, observedAt, ...row }) => { void _run; return { ...row, observedAt: observedAt.toISOString() }; });
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status)) for (const context of contexts) if (context.state === 'PLANNED') { context.state = 'NOT_TESTED'; context.reason = 'Planned authenticated mapping did not complete in this run.'; }
    if (contexts[0] && observations.some(row => row.contextKey === 'ANONYMOUS' && row.responseClass !== 'UNAVAILABLE')) contexts[0].state = 'MAPPED';
    const surfaceVisibility = deriveSurfaceVisibility(contexts, observations);
    const has = (label: 'PUBLIC' | 'AUTHENTICATED_ONLY' | 'SHARED_AUTHENTICATED' | 'CONTEXT_DIFFERENTIAL') => surfaceVisibility.filter(row => row.classifications.includes(label)).length;
    return { scanRunId: run.id, legacy: !snapshot, contexts, observations, surfaceVisibility, totals: { public: has('PUBLIC'), authenticatedOnly: has('AUTHENTICATED_ONLY'), sharedAuthenticated: has('SHARED_AUTHENTICATED'), contextDifferentials: has('CONTEXT_DIFFERENTIAL'), observations: observations.length }, warnings: [AUTH_DIFFERENTIAL_NOTICE, ...(result?.warnings ?? []).map(warning => safeAuthLabel(warning))], truncated: rows.length >= 2000 };
  });
}
