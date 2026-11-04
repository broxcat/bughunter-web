import { describe, expect, it, beforeEach, vi } from 'vitest';
import { AUTH_DIFFERENTIAL_NOTICE, authContextsSnapshot, deriveSurfaceVisibility, safeAuthContexts, safeAuthLabel, safeSurfaceUrl, type AuthContextsSnapshot, type SafeAuthContext, type SurfaceObservation } from '@/lib/authenticatedRecon';
import { privateReferenceFingerprint } from '@/lib/crypto';
import { withTargetExecution } from '@/server/execution';
const mocks = vi.hoisted(() => ({ target: vi.fn(), credentials: vi.fn(), oneCredential: vi.fn(), scan: vi.fn(), observations: vi.fn(), upsert: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { target: { findUnique: mocks.target }, targetCredential: { findMany: mocks.credentials, findFirst: mocks.oneCredential }, scanRun: { findUnique: mocks.scan }, reconSurfaceObservation: { upsert: mocks.upsert } } }));
import { captureAuthenticatedContexts, loadReconCredential, recordSurfaceObservation, safeSurfaceBodyHash, surfaceResponseClass } from '@/server/authenticatedRecon';
import { encryptSecret } from '@/lib/crypto';
import { classifyReconFailure, reconRetryDelay } from '@/lib/reconCapabilities';
const contexts: SafeAuthContext[] = [{ contextKey: 'ANONYMOUS', mode: 'ANONYMOUS', label: 'Anonymous', state: 'MAPPED' }, { contextKey: 'a', mode: 'AUTHENTICATED', label: 'Account A', persona: 'User', state: 'COMPLETED' }, { contextKey: 'b', mode: 'AUTHENTICATED', label: 'Account B', persona: 'Manager', state: 'COMPLETED' }];
const observation = (url: string, contextKey: string, statusCode: number, responseClass = statusCode === 200 ? 'CONTENT' : statusCode === 307 ? 'LOGIN_REDIRECT' : 'DENIED'): SurfaceObservation => ({ id: contextKey + ':' + url, contextKey, contextType: contextKey === 'ANONYMOUS' ? 'ANONYMOUS' : 'AUTHENTICATED', url: 'https://app.example.test' + url, canonicalKey: 'GET:' + url, method: 'GET', statusCode, contentType: 'text/html', redirect: null, redirectPattern: null, responseClass, source: 'native', observedAt: '2026-11-04T00:00:00Z' });
const page = (url = 'https://app.example.test/app/profile') => ({ url, method: 'GET', status: 200, ms: 1, bodyLen: 60, body: '<html>Private Customer Name, email@example.test, TOKEN_VALUE</html>', headers: { 'content-type': 'text/html', 'set-cookie': 'PRIVATE_COOKIE' } });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', 'ab'.repeat(32)); });
describe('Authenticated runtime visibility is an observation, not an authorization verdict', () => {
  it('classifies the controlled anonymous/user/manager fixture deterministically', () => {
    const rows = ['/dashboard', '/profile'].flatMap(url => [observation(url, 'ANONYMOUS', 307), observation(url, 'a', 200), observation(url, 'b', 200)]);
    rows.push(observation('/public', 'ANONYMOUS', 200), observation('/admin', 'ANONYMOUS', 307), observation('/admin', 'a', 403), observation('/admin', 'b', 200));
    const surface = deriveSurfaceVisibility(contexts, rows);
    expect(surface.find(s => s.url.endsWith('/public'))?.classification).toBe('PUBLIC');
    for (const url of ['/dashboard', '/profile']) expect(surface.find(s => s.url.endsWith(url))).toMatchObject({ classification: 'AUTHENTICATED_ONLY', classifications: ['AUTHENTICATED_ONLY', 'SHARED_AUTHENTICATED'] });
    expect(surface.find(s => s.url.endsWith('/admin'))).toMatchObject({ classification: 'CONTEXT_DIFFERENTIAL', visibility: [expect.objectContaining({ statusCode: 307 }), expect.objectContaining({ statusCode: 403 }), expect.objectContaining({ statusCode: 200 })] });
    expect(AUTH_DIFFERENTIAL_NOTICE).toContain('does not demonstrate broken authorization');
  });
  it('does not convert missing coverage, transport failures or duplicate identity into denial', () => {
    const rows = [observation('/admin', 'ANONYMOUS', 307), observation('/admin', 'b', 200)];
    expect(deriveSurfaceVisibility(contexts, rows)[0].classifications).not.toContain('CONTEXT_DIFFERENTIAL');
    expect(deriveSurfaceVisibility(contexts, rows)[0].visibility[1]).toMatchObject({ outcome: 'NOT_OBSERVED_IN_CONTEXT', observed: false });
    rows.push(observation('/admin', 'a', 0, 'UNAVAILABLE')); expect(deriveSurfaceVisibility(contexts, rows)[0].classifications).not.toContain('CONTEXT_DIFFERENTIAL');
    rows[2] = observation('/admin', 'a', 403); expect(deriveSurfaceVisibility(contexts.map(c => c.contextKey === 'a' ? { ...c, state: 'AUTH_CONTEXT_DUPLICATE_IDENTITY' } : c), rows)[0].classifications).not.toContain('CONTEXT_DIFFERENTIAL');
  });
  it('keeps missing historical snapshots unknown and strips credential metadata from context DTOs', () => {
    expect(authContextsSnapshot(null)).toBeNull(); expect(safeAuthContexts(null)).toEqual([]);
    const snapshot: AuthContextsSnapshot = { version: 1, anonymous: { contextKey: 'ANONYMOUS', mode: 'ANONYMOUS' }, contextLimit: 4, contexts: [{ credentialId: 'PRIVATE_CREDENTIAL_ID', contextKey: 'a', label: 'alice@example.test', purpose: 'ACCOUNT_A', persona: 'User', sessionIdentityHash: 'PRIVATE_IDENTITY_HASH', sessionCheckId: 'PRIVATE_CHECK', sessionStatus: 'VALID', checkedAt: null, expiresAt: null, validationUrl: 'https://private.example.test/profile', ownedObjectUrl: null, eligibility: 'PLANNED' }] };
    const serialized = JSON.stringify(safeAuthContexts(snapshot)); expect(serialized).not.toMatch(/PRIVATE_|alice@example|private.example|credentialId|sessionIdentityHash|validationUrl/);
    expect(safeAuthLabel('Account A')).toBe('Account A'); expect(safeSurfaceUrl('https://user:pass@app.example.test/users/alice?secret=PRIVATE#TOKEN')).not.toMatch(/alice|PRIVATE|user:pass|TOKEN/);
  });
  it('uses keyed private reference identities without serializing private URL values', () => {
    expect(privateReferenceFingerprint('scope', '/users/alice')).not.toBe(privateReferenceFingerprint('scope', '/users/bob'));
    expect(privateReferenceFingerprint('scope', '/users/alice')).toBe(privateReferenceFingerprint('scope', '/users/alice'));
    expect(privateReferenceFingerprint('other-scope', '/users/alice')).not.toBe(privateReferenceFingerprint('scope', '/users/alice'));
    expect(safeSurfaceBodyHash('{"name":"Alice","email":"alice@example.test"}', 'application/json')).toBe(safeSurfaceBodyHash('{"name":"Bob","email":"bob@example.test"}', 'application/json'));
    expect(safeSurfaceBodyHash('<h1>Alice private email</h1>')).toBe(safeSurfaceBodyHash('<h1>Bob token</h1>'));
  });
  it('distinguishes a public login page, a login response and an endpoint-specific denial', () => {
    const login = { ...page('https://app.example.test/login'), body: '<input type="password">' };
    expect(surfaceResponseClass(login, 'ANONYMOUS')).toBe('CONTENT'); expect(surfaceResponseClass(login)).toBe('LOGIN_REDIRECT');
    expect(surfaceResponseClass({ ...page('https://app.example.test/settings'), body: '<form action="/settings/password"><input type="password" name="newPassword"></form>' })).toBe('CONTENT');
    expect(surfaceResponseClass({ ...page('https://app.example.test/dashboard'), body: '<form action="/login"><input type="password"></form>' })).toBe('LOGIN_REDIRECT');
    expect(surfaceResponseClass({ ...page(), status: 403 })).toBe('DENIED'); expect(surfaceResponseClass({ ...page(), status: 0, error: 'network' })).toBe('UNAVAILABLE');
  });
});
describe('Run-time credential snapshot and live exact-target selection', () => {
  const targetId = 'target', asset = { id: 'asset', format: 'URL', normalizedValue: 'https://app.example.test/app/', active: true, originalValue: 'https://app.example.test/app/', programId: 'program', type: 'API', assetValue: 'HIGH' };
  const execution = { targetId, host: 'app.example.test', requiredUserAgent: 'Fixture/1', qualifying: [], nonQualifying: [], scopeAsset: asset };
  async function capture(rows = 7) {
    mocks.target.mockResolvedValue({ host: 'app.example.test', scheme: 'https', contextOnly: false, scopeAsset: asset, program: { deletingAt: null } });
    mocks.credentials.mockResolvedValue(Array.from({ length: rows }, (_, index) => ({ id: 'credential-' + index, label: 'Account ' + index, persona: 'User', purpose: 'ACCOUNT_A', sessionStatus: 'VALID', sessionCheckedAt: new Date(), sessionExpiresAt: new Date(Date.now() + 300000), sessionCheckId: 'check', sessionIdentityHash: index === 1 ? 'identity-0' : 'identity-' + index, validationUrl: 'https://app.example.test/app/profile', ownedObjectUrl: null })));
    return captureAuthenticatedContexts({ target: { findUniqueOrThrow: mocks.target }, targetCredential: { findMany: mocks.credentials }, $queryRaw: vi.fn() } as never, targetId);
  }
  it('captures only metadata, enforces context cap and records duplicate identities explicitly', async () => {
    const snapshot = await capture(); expect(snapshot.contexts.filter(c => c.eligibility === 'PLANNED')).toHaveLength(4);
    expect(snapshot.contexts[1].eligibility).toBe('AUTH_CONTEXT_DUPLICATE_IDENTITY'); expect(snapshot.contexts.at(-1)?.eligibility).toBe('AUTH_CONTEXT_LIMIT');
    const select = mocks.credentials.mock.calls[0][0].select; for (const field of ['cookiesCipher', 'headerCipher', 'emailCipher', 'passwordCipher', 'sessionCookiesCipher']) expect(select[field]).toBeUndefined();
    expect(mocks.credentials.mock.calls[0][0].where).toEqual({ targetId, reconEnabled: true });
  });
  it('uses only current verified session material and never selects login secrets', async () => {
    const context = (await capture(1)).contexts[0], now = new Date(context.checkedAt!);
    const row = { ...context, id: context.credentialId, mode: 'EMAIL_PASSWORD', sessionCheckedAt: now, sessionExpiresAt: new Date(Date.now() + 300000), sessionStatus: 'VALID', cookiesCipher: null, sessionCookiesCipher: encryptSecret('{"session":"MINTED_SESSION_SECRET"}'), headerCipher: null, ownedObjectUrl: null, validationUrl: context.validationUrl, sessionIdentityHash: context.sessionIdentityHash };
    mocks.oneCredential.mockResolvedValue(row);
    await withTargetExecution(execution, async () => {
      expect((await loadReconCredential(targetId, context, context.validationUrl!))?.cookies).toEqual({ session: 'MINTED_SESSION_SECRET' });
      mocks.oneCredential.mockResolvedValue({ ...row, ownedObjectUrl: 'https://app.example.test/app/orders/1234', validationUrl: 'https://app.example.test/app/profile?changed=true' });
      const edited = await loadReconCredential(targetId, context, context.validationUrl!);
      expect(edited?.validationUrl).toBeNull(); expect(edited?.ownedObjectUrl).toBeNull();
      mocks.oneCredential.mockResolvedValue(row);
      const select = mocks.oneCredential.mock.calls[0][0].select; expect(select.emailCipher).toBeUndefined(); expect(select.passwordCipher).toBeUndefined();
      expect(await loadReconCredential('other-target', context, context.validationUrl!)).toBeNull(); expect(await loadReconCredential(targetId, context, 'https://sibling.example.test/app/')).toBeNull(); expect(await loadReconCredential(targetId, context, 'https://app.example.test/outside')).toBeNull();
      mocks.oneCredential.mockResolvedValue({ ...row, sessionCheckId: 'rotated' }); expect(await loadReconCredential(targetId, context, context.validationUrl!)).toBeNull();
      mocks.oneCredential.mockResolvedValue({ ...row, sessionExpiresAt: new Date(Date.now() - 1) }); expect(await loadReconCredential(targetId, context, context.validationUrl!)).toBeNull();
    });
  });
  it('persists context-specific status evidence without private bodies, response headers or PII', async () => {
    const snapshot = await capture(1); mocks.scan.mockResolvedValue({ targetId, scopeAssetId: asset.id, authenticatedContextsSnapshot: snapshot }); mocks.upsert.mockImplementation(async input => input.create);
    await withTargetExecution(execution, async () => {
      const signed = await recordSurfaceObservation('scan', asset.id, snapshot.contexts[0], page()); const anonymous = await recordSurfaceObservation('scan', asset.id, 'ANONYMOUS', { ...page(), status: 307, headers: { location: '/login?token=PRIVATE' } });
      expect(signed?.statusCode).toBe(200); expect(anonymous?.statusCode).toBe(307); expect(signed?.contextKey).not.toBe(anonymous?.contextKey);
      expect(signed?.canonicalKey).toBe(anonymous?.canonicalKey); expect(JSON.stringify(mocks.upsert.mock.calls)).not.toMatch(/Private Customer|email@example|TOKEN_VALUE|PRIVATE_COOKIE|token=PRIVATE/);
      const browser = await recordSurfaceObservation('scan', asset.id, snapshot.contexts[0], { ...page(), body: '', bodyLen: 0, bodyAvailable: false }, 'browser'); expect(browser).not.toHaveProperty('bodyHash'); expect(browser).not.toHaveProperty('bodyLength');
    });
  });
});

describe('authenticated Recon failure taxonomy', () => {
  it.each(['SESSION_UNAVAILABLE','SESSION_EXPIRED','SESSION_LOST','AUTH_CONTEXT_LIMIT','AUTH_CONTEXT_DUPLICATE_IDENTITY','AUTH_CONTEXT_SCOPE_BLOCKED'] as const)('never retries %s or substitutes a login', code => {
    const failure=classifyReconFailure(code,'AUTHENTICATED_MAPPING','guarded-auth-mapper');
    expect(failure).toMatchObject({reason:code,retryable:false,coverageImpact:'REDUCED',capability:'AUTHENTICATED_MAPPING'});
    expect(reconRetryDelay(failure,0)).toBeNull();
  });
  it('keeps internal failures distinct from unavailable sessions and target network failures', () => {
    expect(classifyReconFailure('INTERNAL_AUTH_RECON_FAILURE','AUTHENTICATED_MAPPING')).toMatchObject({category:'ENVIRONMENT',reason:'INTERNAL_AUTH_RECON_FAILURE',retryable:false});
    expect(classifyReconFailure('AUTH_CONTEXT_NETWORK_UNREACHABLE','AUTHENTICATED_MAPPING')).toMatchObject({category:'TARGET',reason:'NETWORK_UNREACHABLE'});
    expect(classifyReconFailure('AUTH_RELAY_FAILURE','AUTHENTICATED_MAPPING')).toMatchObject({category:'ENVIRONMENT',reason:'AUTH_RELAY_FAILURE'});
  });
});
