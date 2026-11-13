import { describe, expect, it } from 'vitest';
import { buildReconPlan, reconUrlAllowed } from '@/lib/reconPlanner';
import { detectScopeAsset } from '@/lib/scopeAssets';
import { evaluateCapability, reconFailure, reconRetryDelay, classifyReconFailure, requiredCoverageSatisfied, type ReconProviderAttempt } from '@/lib/reconCapabilities';
import { calibrateContent, classifyBaseline, responseFingerprint, compareWithBaseline, gobusterCalibrationPolicy } from '@/server/recon/calibration';
import type { ProbeResult } from '@/server/scanners/http';
import { normalizeArtifact } from '@/lib/reconArtifacts';
import { deriveAssetGraph } from '@/lib/reconGraph';
import { reconToolArguments } from '@/server/recon/toolArguments';
import { dnsLookupCoverage } from '@/server/recon/dnsIntelligence';
const build = (value = 'https://app.example.test/app/', type = 'WEB_APPLICATION', assetValue = 'MEDIUM', authorized = true) => buildReconPlan({ id: 'asset', ...detectScopeAsset(value), type, assetValue, active: true }, { active: authorized, exclusions: ['excluded.example.test'] });
const page = (url: string, status = 200, body = '<html><title>Known</title>Distinct route</html>', headers: Record<string, string> = {}): ProbeResult => ({ url, method: 'GET', status, body, bodyLen: Buffer.byteLength(body), ms: 1, headers: { 'content-type': 'text/html', ...headers } });
const controls = (make: (url: string, i: number) => ProbeResult) => [0, 1, 2].map(i => responseFingerprint(make(`https://app.example.test/app/__bughunter_control${i}`, i)));
const completed = (provider: string, coverageSatisfied = true): ReconProviderAttempt => ({ provider, state: 'COMPLETED', coverageSatisfied, artifactsProduced: 0, durationMs: 12 });
describe('methodology v2 objectives, scope and provider substitution', () => {
  it.each([
    ['*.example.test', 'WILDCARD', 'LOW', 'WIDE', 'LIGHT'], ['*.example.test', 'WILDCARD', 'CRITICAL', 'WIDE', 'DEEP'],
    ['example.test', 'WEB_APPLICATION', 'MEDIUM', 'DEEP', 'STANDARD'], ['example.test', 'WEB_APPLICATION', 'CRITICAL', 'DEEP', 'DEEP'],
    ['app.example.test', 'WEB_APPLICATION', 'MEDIUM', 'DEEP', 'STANDARD'], ['api.example.test', 'API', 'HIGH', 'DEEP', 'DEEP'],
    ['https://app.example.test/app/', 'WEB_APPLICATION', 'LOW', 'DEEP', 'LIGHT'], ['https://app.example.test/app/', 'WEB_APPLICATION', 'CRITICAL', 'DEEP', 'DEEP'],
    ['https://api.example.test/v1/', 'API', 'HIGH', 'DEEP', 'DEEP'],
  ])('%s × %s × %s preserves budget depth and adds %s strategy', (value, type, importance, strategy, depth) => {
    const p = build(value, type, importance); expect(p).toMatchObject({ methodologyVersion: 2, strategy, depth }); expect(p.capabilities!.length).toBeGreaterThan(12);
    expect(p.capabilities!.filter(c => c.required).map(c => c.id)).toContain('AUTHORIZATION'); expect(p.capabilities!.filter(c => c.required).map(c => c.id)).toContain('NORMALIZATION');
    expect(p.capabilities!.find(c => c.id === 'SURFACE_TEMPLATE_MATCHING')?.required).toBe(false);
    expect(p.limits.rps).toBeLessThanOrEqual(3); expect(p.limits.maxRequests).toBeLessThanOrEqual(1200);
    expect(reconUrlAllowed(p, 'https://outside.test/')).toBe(false); if (p.format === 'URL') expect(p.limits.ports).toEqual([]);
  });
  it('keeps traffic authorization, WIDE/DEEP orientation and LIGHT/STANDARD/DEEP budgets separate', () => {
    expect(build('*.example.test', 'WILDCARD', 'CRITICAL', false)).toMatchObject({ strategy: 'WIDE', depth: 'DEEP', activityMode: 'PASSIVE' });
    for (const importance of ['LOW', 'CRITICAL']) { const p = build('api.example.test', 'API', importance); expect(reconUrlAllowed(p, 'https://admin.example.test/')).toBe(false); }
  });
  it('explains newly added exact-asset WIDE orientation consistently without expanding its boundary', () => {
    const plan = buildReconPlan({ id: 'new-asset', ...detectScopeAsset('api.example.test'), type: 'API', assetValue: 'HIGH', active: true }, { active: true, exclusions: [] }, { newSurface: true });
    expect(plan.strategy).toBe('WIDE'); expect(plan.rationale[0]).toMatch(/^WIDE /);
    expect(reconUrlAllowed(plan, 'https://other.example.test/')).toBe(false);
  });
  it('reports completion with fallback when FFUF substitutes for a skipped Gobuster', () => {
    const spec = build('https://app.example.test/app/', 'WEB_APPLICATION', 'LOW').capabilities!.find(c => c.id === 'CONTENT_DISCOVERY')!;
    const result = evaluateCapability(spec, [{ provider: 'gobuster', state: 'SKIPPED_NOT_APPLICABLE', coverageSatisfied: false, artifactsProduced: 0, durationMs: 2, failure: reconFailure('NON_DISCRIMINATING_WILDCARD_RESPONSE', { capability: spec.id, tool: 'gobuster' }) }, { ...completed('ffuf'), fallback: true }]);
    expect(result).toMatchObject({ state: 'COMPLETED_WITH_FALLBACK', coverageImpact: 'NONE', fallbacks: ['ffuf'] }); expect(requiredCoverageSatisfied([result])).toBe(true);
  });
  it('requires validated coverage rather than exit zero or merely observed crawler links', () => {
    const spec = build().capabilities!.find(c => c.id === 'CONTENT_DISCOVERY')!;
    expect(evaluateCapability(spec, [completed('ffuf', false)]).state).toBe('FAILED');
    expect(evaluateCapability(spec, [completed('bounded-crawler')]).state).toBe('FAILED');
    expect(evaluateCapability(spec, [{...completed('bounded-crawler'),coverageBasis:'CALIBRATED_ENUMERATION'}]).state).toBe('COMPLETED_WITH_FALLBACK');
    expect(evaluateCapability(spec, [completed('unknown-provider')]).state).toBe('FAILED');
    expect(evaluateCapability(spec, [{ provider: 'bounded-crawler', state: 'PARTIAL', coverageSatisfied: false, artifactsProduced: 7, durationMs: 1 }]).state).toBe('PARTIAL');
  });
  it('distinguishes inapplicable HTTP-only TLS enrichment from unavailable tools without waiving required coverage', () => {
    const tls = build().capabilities!.find(c => c.id === 'TLS_MAPPING')!;
    const skipped = (provider: string): ReconProviderAttempt => ({ provider, state: 'SKIPPED_NOT_APPLICABLE', coverageSatisfied: false, artifactsProduced: 0, durationMs: 0 });
    expect(evaluateCapability(tls, [skipped('native-tls')])).toMatchObject({ state: 'SKIPPED_NOT_APPLICABLE', coverageImpact: 'NONE' });
    expect(evaluateCapability(tls, [{ ...skipped('native-tls'), state: 'SKIPPED_UNSUPPORTED' }])).toMatchObject({ state: 'SKIPPED_UNSUPPORTED', coverageImpact: 'NONE' });
    const content = build().capabilities!.find(c => c.id === 'CONTENT_DISCOVERY')!;
    const unmet = evaluateCapability(content, content.providers.map(skipped));
    expect(unmet).toMatchObject({ state: 'PARTIAL', coverageImpact: 'REDUCED' });
    expect(requiredCoverageSatisfied([unmet])).toBe(false);
  });
  it('requires only two passive sources and does not downgrade coverage because a third optional source failed', () => {
    const spec = build('*.example.test', 'WILDCARD', 'LOW').capabilities!.find(c => c.id === 'PASSIVE_SUBDOMAIN_DISCOVERY')!;
    expect(evaluateCapability(spec, [completed('subfinder'), completed('amass'), { provider: 'assetfinder', state: 'FAILED', coverageSatisfied: false, artifactsProduced: 0, durationMs: 1 }])).toMatchObject({ state: 'COMPLETED', coverageImpact: 'NONE' });
  });
  it('centralizes permanent and transient failure reasons with bounded retry', () => {
    const permanent = ['MISSING_TOOL', 'INCOMPATIBLE_TOOL', 'MISSING_WORDLIST', 'MISSING_TEMPLATE', 'SOFT_404', 'SCOPE_BLOCKED', 'PARSER_FAILURE', 'CANCELLED'] as const;
    for (const reason of permanent) expect(reconRetryDelay(reconFailure(reason, { capability: 'CONTENT_DISCOVERY' }), 0)).toBeNull();
    const timed = reconFailure('TIMEOUT', { capability: 'HTTP_DISCOVERY', tool: 'httpx' }); expect(reconRetryDelay(timed, 0)).toBe(250); expect(reconRetryDelay(timed, 1)).toBe(500); expect(reconRetryDelay(timed, 2)).toBeNull();
    expect(classifyReconFailure(new Error('EAI_AGAIN'), 'DNS_RESOLUTION').retryable).toBe(true); expect(classifyReconFailure(new Error('NXDOMAIN'), 'DNS_RESOLUTION').retryable).toBe(false);
    expect(classifyReconFailure(new Error('queryCname ESERVFAIL example.test'), 'DNS_RESOLUTION')).toMatchObject({ reason: 'DNS_FAILURE', retryable: true, category: 'TARGET' });
  });
  it('retains incomplete DNS coverage even when a different address record resolved', () => {
    const fulfilled: PromiseFulfilledResult<string[]> = { status: 'fulfilled', value: ['192.0.2.1'] };
    const negative: PromiseRejectedResult = { status: 'rejected', reason: Object.assign(new Error('queryAaaa ENODATA'), { code: 'ENODATA' }) };
    expect(dnsLookupCoverage([fulfilled, negative, { status: 'rejected', reason: new Error('queryCname ENOTFOUND example.test') }])).toMatchObject({ complete: true, incomplete: [] });
    expect(dnsLookupCoverage([{ status: 'rejected', reason: new Error('NXDOMAIN') }, negative])).toMatchObject({ complete: true });
    for (const code of ['ETIMEOUT', 'EAI_AGAIN', 'ECONNREFUSED']) {
      expect(dnsLookupCoverage([fulfilled, { status: 'rejected', reason: Object.assign(new Error(code), { code }) }])).toMatchObject({ complete: false, incomplete: [code] });
    }
  });
});
describe('shared negative controls and soft-404 classification', () => {
  it('distinguishes real 404 and never considers status alone an interesting result', () => {
    const baseline = classifyBaseline(controls(url => page(url, 404, 'Not Found'))); expect(baseline.classification).toBe('REAL_404'); expect(gobusterCalibrationPolicy(baseline).enabled).toBe(true);
    expect(compareWithBaseline(page('https://app.example.test/app/admin', 404, 'Not Found'), baseline).equivalent).toBe(true);
    expect(compareWithBaseline(page('https://app.example.test/app/admin', 200, 'Actual administrative route'), baseline).equivalent).toBe(false);
  });
  it.each([302, 307])('normalizes global %s redirects with reflected callback values and skips unsuitable Gobuster', status => {
    const baseline = classifyBaseline(controls(url => page(url, status, '', { location: '/login?callbackUrl=' + encodeURIComponent(new URL(url).pathname) })));
    expect(baseline).toMatchObject({ classification: 'WILDCARD_REDIRECT', stable: true }); expect(baseline.redirectPattern).toContain('callbackUrl=<input>');
    expect(gobusterCalibrationPolicy(baseline)).toMatchObject({ enabled: false, reason: 'NON_DISCRIMINATING_WILDCARD_RESPONSE' });
    expect(compareWithBaseline(page('https://app.example.test/app/admin', status, '', { location: '/login?callbackUrl=%2Fapp%2Fadmin' }), baseline).equivalent).toBe(true);
    expect(compareWithBaseline(page('https://app.example.test/app/admin', status, '', { location: '/different-login' }), baseline).equivalent).toBe(false);
  });
  it('recognizes constant soft-200 but requires known discrimination before adding a length exclusion', async () => {
    const baseline = await calibrateContent('https://app.example.test/app/', async url => page(url, 200, 'Unknown route'), { knownResponses: [page('https://app.example.test/app/', 200, 'Distinct real application homepage')] });
    expect(baseline.classification).toBe('SOFT_404'); expect(gobusterCalibrationPolicy(baseline)).toMatchObject({ enabled: true, excludeLengths: [13] });
    expect(gobusterCalibrationPolicy({ ...baseline, distinguishingResponseLengths: [] }).enabled).toBe(false);
    expect(compareWithBaseline(page('https://app.example.test/app/.git/config', 200, '[core]\nrepositoryformatversion = 0'), baseline)).toMatchObject({ equivalent: false, reason: 'DISTINCT_SEMANTIC_MARKER' });
  });
  it('normalizes explicit variable nonce and request-path echoes without hiding real business differences', () => {
    const baseline = classifyBaseline(controls((url, i) => page(url, 200, `<html><title>Unknown</title>Path ${new URL(url).pathname} nonce="random-${i}"</html>`)));
    expect(baseline).toMatchObject({ classification: 'SOFT_404', stable: true }); expect(baseline.bodyHashes).toHaveLength(3); expect(baseline.normalizedBodyHashes).toHaveLength(1);
    expect(compareWithBaseline(page('https://app.example.test/app/admin', 200, '<html>Actual admin data</html>'), baseline).equivalent).toBe(false);
  });
  it('declares unexplained changing bodies unstable and does not issue a lossy Gobuster status filter', () => {
    const baseline = classifyBaseline(controls((url, i) => page(url, 200, `Different unlabelled content ${i}`))); expect(baseline.classification).toBe('UNSTABLE_BASELINE'); expect(gobusterCalibrationPolicy(baseline).enabled).toBe(false); expect(gobusterCalibrationPolicy(baseline).excludeStatuses).toBeUndefined();
  });
  it('keeps calibration inside the authorized URL path and stops immediately on rate limit', async () => {
    const p = build(); const called: string[] = [];
    const baseline = await calibrateContent(p.boundary.normalizedValue, async url => { called.push(url); return page(url, 429, 'rate limit'); }, { allowed: url => reconUrlAllowed(p, url) });
    expect(called).toHaveLength(1); expect(called[0]).toContain('/app/__bughunter_'); expect(baseline.classification).toBe('UNSTABLE_BASELINE');
    await expect(calibrateContent('https://outside.test/', async url => page(url), { allowed: url => reconUrlAllowed(p, url) })).rejects.toThrow('SCOPE_BLOCKED');
  });
  it('never turns missing responses into evidence of absence or silently ignores cancellation', async () => {
    const baseline = await calibrateContent('https://app.example.test/app/', async url => ({ ...page(url), error: 'temporary DNS', status: 0 })); expect(baseline).toMatchObject({ classification: 'UNSTABLE_BASELINE', errors: 3, stable: false });
    await expect(calibrateContent('https://app.example.test/', async url => page(url), { signal: AbortSignal.abort() })).rejects.toThrow();
  });
  it('does not persist redirect secrets or HTTP title credential values', () => {
    const value = responseFingerprint(page('https://app.example.test/app/x', 307, '<title>Authorization: Bearer PRIVATE_VALUE</title>', { location: '/login?token=PRIVATE_VALUE' }));
    expect(JSON.stringify(value)).not.toContain('PRIVATE_VALUE');
  });
  it('applies only audited Gobuster length filters and keeps force/redirect following absent', () => {
    const p = build(), base = classifyBaseline(controls(url => page(url, 200, 'Not here'))); base.distinguishingResponseLengths = [42];
    const args = reconToolArguments('gobuster', ['dir', '-u', 'http://127.0.0.1:9123/app/', '-w', '/tmp/list'], { reconPlan: p, host: 'app.example.test', requiredUserAgent: 'Fixture/1', reconRelayOrigin: 'http://127.0.0.1:9123', reconRelayTarget: 'https://app.example.test/app/', gobusterWordlist: '/tmp/list', contentBaseline: base });
    expect(args).toContain('--exclude-length'); expect(args).not.toContain('--force'); expect(args).not.toContain('--follow-redirect');
  });
});
describe('evidence-backed graph without authorization expansion', () => {
  const at = '2026-11-04T00:00:00Z', boundary = { normalizedValue: '*.example.test', format: 'WILDCARD_DOMAIN' };
  const fact = (id: string, kind: Parameters<typeof normalizeArtifact>[0], value: Record<string, unknown>) => ({ ...normalizeArtifact(kind, value, { tool: 'fixture', sourceRef: id, observedAt: at }, boundary, [], 'OBSERVED')!, id });
  it('correlates DNS/CNAME, observed references, parameters, auth and services with original source IDs', () => {
    const rows = [fact('dns', 'observation', { hostname: 'app.example.test', type: 'dns-address', addresses: ['192.0.2.1'] }), fact('alias', 'hostname', { hostname: 'provider.outside.test', relationship: 'CNAME', origin: 'app.example.test' }), fact('link', 'endpoint', { url: 'https://api.example.test/v1/items', discoveredFrom: 'https://app.example.test/' }), fact('param', 'parameter', { url: 'https://api.example.test/v1/items', name: 'userId' }), fact('auth', 'auth-surface', { url: 'https://app.example.test/forgot-password' }), fact('port', 'port', { hostname: 'app.example.test', port: 443, protocol: 'tcp', state: 'open' })];
    const graph = deriveAssetGraph(rows); expect(graph.authorizationGranted).toBe(false); expect(graph.edges.map(e => e.relation)).toEqual(expect.arrayContaining(['RESOLVES_TO', 'CNAME', 'REFERENCES', 'HAS_PARAMETER', 'RESET_ROUTE', 'HOSTS_SERVICE']));
    expect(graph.nodes.find(n => n.type === 'IP')?.inScope).toBe(false); expect(graph.nodes.find(n => n.value === 'provider.outside.test')?.inScope).toBe(false); expect(graph.edges.every(e => e.evidenceRefs.length > 0)).toBe(true); expect(graph.edges.every(e=>e.id.length<150)).toBe(true);
    expect(deriveAssetGraph([...rows].reverse())).toEqual(graph);
  });
  it('omits unsupported relationship claims and bounds the graph without inventing edges', () => {
    const row = fact('single', 'endpoint', { url: 'https://app.example.test/api' }); expect(deriveAssetGraph([row]).edges).toEqual([]); expect(deriveAssetGraph([{ ...row, id: undefined }]).nodes).toEqual([]);
    const graph = deriveAssetGraph([row, fact('other', 'endpoint', { url: 'https://app.example.test/login' })], { nodes: 1, edges: 1 }); expect(graph.truncated).toBe(true); expect(graph.nodes).toHaveLength(1);
  });
});
