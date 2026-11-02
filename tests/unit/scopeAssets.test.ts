import { describe, expect, it } from 'vitest';
import { detectScopeAsset, assetAllowsHost, assetAllowsUrl, assetReconStatus, assetValueRank } from '@/lib/scopeAssets';
import { assetReconPlan } from '@/lib/reconPipeline';
import { consoleBundle } from '@/server/research/consoleWorkspace';
import { consolePolicySchema } from '@/lib/research/consolePolicy';
import { researchTarget } from '../fixtures/research';
import { enforceHttp1, enforceHttp2 } from '../../docker/research/validator/burp-active.mjs';
import { sanitizeHistoryItem } from '../../docker/research/validator/burp-http.mjs';
import { buildReconContext, compactReconContext, reconJson, RECON_SUMMARY_BYTES } from '@/server/research/reconContext';
import { expandAssetReconRuns } from '@/server/research/reconInputs';
import { researchRecon } from '../fixtures/research';
import { markdownText, scopeFilename } from '@/server/scopeMarkdown';

describe('deterministic scope asset detection', () => {
  it.each([
    ['*.vfsevisa.com', '*.vfsevisa.com', 'WILDCARD_DOMAIN', 'WILDCARD'],
    ['\\*.vfsevisa.com', '*.vfsevisa.com', 'WILDCARD_DOMAIN', 'WILDCARD'],
    ['www.vfsvisaonline.com', 'www.vfsvisaonline.com', 'SUBDOMAIN', 'WEB_APPLICATION'],
    ['www\\.vfsvisaonline.com', 'www.vfsvisaonline.com', 'SUBDOMAIN', 'WEB_APPLICATION'],
    ['https://equatorialguinea-evisa.com', 'https://equatorialguinea-evisa.com/', 'URL', 'WEB_APPLICATION'],
    ['agents.tasheer.com', 'agents.tasheer.com', 'SUBDOMAIN', 'WEB_APPLICATION'],
    ['api.EXAMPLE.COM', 'api.example.com', 'SUBDOMAIN', 'API'],
    [' HTTPS://PORTAL.EXAMPLE.COM:8443/app/ ', 'https://portal.example.com:8443/app/', 'URL', 'WEB_APPLICATION'],
    ['192.0.2.1', '192.0.2.1', 'IP', 'OTHER'], ['2001:db8::1', '2001:db8::1', 'IP', 'OTHER'],
    ['192.0.2.0/24', '192.0.2.0/24', 'CIDR', 'OTHER'], ['2001:DB8::/32', '2001:db8::/32', 'CIDR', 'OTHER'],
    ['localhost', 'localhost', 'HOSTNAME', 'OTHER'], ['xn--bcher-kva.example', 'xn--bcher-kva.example', 'DOMAIN', 'WEB_APPLICATION'],
  ])('detects %s without changing its authorization meaning', (value, normalizedValue, format, inferredType) => {
    const result = detectScopeAsset(value); expect(result).toMatchObject({ originalValue: value, normalizedValue, format, inferredType });
    expect(detectScopeAsset(value)).toEqual(result);
  });
  it.each(['', '*example.com', '*.example', 'evil.example.com;id', 'a b.example', 'https://u:secret@example.com/', 'https://example.com/?token=secret', 'https://example.com/#scope', 'ftp://example.com', 'https://bücher.example/', 'https://example.com/%2e%2e/admin', '999.2.3.4', '192.0.2.1/99', 'example.com\\s'])('rejects invalid/ambiguous input %s', value => { expect(() => detectScopeAsset(value)).toThrow(); });
  it('never enables active IP/CIDR/single-label work through detection', () => { for (const value of ['192.0.2.1', '2001:db8::1', '192.0.2.0/24', 'localhost']) expect(detectScopeAsset(value).executable).toBe(false); });
});
describe('one asset authorization boundary', () => {
  const wildcard = { normalizedValue: '*.example.com', format: 'WILDCARD_DOMAIN', active: true };
  const url = { normalizedValue: 'https://portal.example.com:8443/app', format: 'URL', active: true };
  it('covers nested wildcard descendants, never apex or lookalikes', () => {
    expect(assetAllowsHost(wildcard, 'api.example.com')).toBe(true); expect(assetAllowsHost(wildcard, 'x.api.example.com')).toBe(true);
    for (const host of ['example.com', 'evil-example.com', 'example.com.evil.test']) expect(assetAllowsHost(wildcard, host)).toBe(false);
    expect(assetAllowsHost({ ...wildcard, active: false }, 'api.example.com')).toBe(false);
  });
  it('keeps exact origin, port and segment-aware path restrictions including encoded traversal', () => {
    for (const value of ['https://portal.example.com:8443/app', 'https://portal.example.com:8443/app/users?q=1']) expect(assetAllowsUrl(url, value)).toBe(true);
    for (const value of ['https://portal.example.com/app', 'http://portal.example.com:8443/app', 'https://portal.example.com:8443/application', 'https://portal.example.com:8443/admin', 'https://portal.example.com:8443/app/%2fadmin', 'https://portal.example.com:8443/app/%252e%252e/admin', 'https://u:secret@portal.example.com:8443/app']) expect(assetAllowsUrl(url, value)).toBe(false);
  });
  it('keeps not started, partial, failed and stale outcomes distinct', () => {
    const finishedAt = '2026-10-01T00:00:00Z', now = Date.parse('2026-11-02T00:00:00Z');
    expect(assetReconStatus(null)).toBe('NOT_STARTED');
    expect(assetReconStatus({ status: 'COMPLETED', outcome: 'PARTIAL', finishedAt }, now)).toBe('PARTIAL');
    expect(assetReconStatus({ status: 'COMPLETED', outcome: null, finishedAt }, now)).toBe('FAILED');
    expect(assetReconStatus({ status: 'COMPLETED', outcome: 'SUCCESS', finishedAt }, now)).toBe('STALE');
    expect(assetReconStatus({ status: 'RUNNING', outcome: null, finishedAt: null }, now)).toBe('RUNNING');
    expect(assetValueRank('CRITICAL')).toBeLessThan(assetValueRank('HIGH'));
  });
  it('adapts collection by actual format and editable type without broadening scope', () => {
    expect(assetReconPlan({ format: 'WILDCARD_DOMAIN', type: 'WILDCARD' })).toMatchObject({ wildcard: true, maxHosts: 8 });
    expect(assetReconPlan({ format: 'URL', type: 'API' })).toMatchObject({ api: true, guardedHttpOnly: true, documentation: expect.arrayContaining(['openapi.json', 'graphql']) });
    expect(assetReconPlan({ format: 'DOMAIN', type: 'WILDCARD' }).wildcard).toBe(false);
    expect(assetReconPlan({ format: 'DOMAIN', type: 'OTHER' }).documentation).toEqual([]);
  });
});
describe('asset policy and existing Burp MCP', () => {
  function bundle() {
    const target = researchTarget(); target.contextOnly = true; target.active = false;
    target.scopeAsset = { id: 'asset', programId: 'program', originalValue: 'https://app.example.test:8443/app', normalizedValue: 'https://app.example.test:8443/app', format: 'URL', type: 'API', assetValue: 'HIGH', active: true, updatedAt: new Date() };
    return consoleBundle(target, null, [], { id: 'session', workspaceId: 'research_target', createdAt: new Date('2026-11-02T00:00:00Z') });
  }
  it('uses the same scoped policy for Codex/Claude without changing historical defaults', () => {
    const files = bundle(), policy = consolePolicySchema.parse(JSON.parse(files['.agents/bughunter/policy.json']));
    expect(policy).toMatchObject({ port: 8443, mode: 'SCOPED_ACTIVE_HTTP', assetScope: { format: 'URL' } });
    expect(files['scope.md']).toContain('https://app.example.test:8443/app'); expect(files['scope.md']).toContain('Asset value (priority only): HIGH');
    const request = { targetHostname: 'app.example.test', targetPort: 8443, usesHttps: true, content: 'GET /app/users HTTP/1.1\r\nHost: app.example.test\r\n\r\n' };
    expect(enforceHttp1(request, policy).content).toContain('Research-Test/1');
    expect(() => enforceHttp1({ ...request, content: request.content.replace('/app/users', '/admin') }, policy)).toThrow('OUT_OF_SCOPE');
    expect(() => enforceHttp2({ targetHostname: 'app.example.test', targetPort: 8443, usesHttps: true, pseudoHeaders: { ':authority': 'app.example.test:8443', ':scheme': 'https', ':method': 'GET', ':path': '/admin' }, headers: {}, requestBody: '' }, policy)).toThrow('OUT_OF_SCOPE');
    const raw = { request: request.content, response: 'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n' };
    expect(sanitizeHistoryItem(raw, policy)?.status).toBe(200);
    expect(sanitizeHistoryItem({ ...raw, request: raw.request.replace('/app/users', '/admin') }, policy)).toBeNull();
  });
  it('wildcard Research remains passive and its policy only covers the selected parent', () => {
    const target = researchTarget(); target.contextOnly = true; target.active = false; target.host = '*.example.test'; target.scope.hostPattern = '*.example.test';
    target.scopeAsset = { id: 'wild', programId: 'program', originalValue: '*.example.test', normalizedValue: '*.example.test', format: 'WILDCARD_DOMAIN', type: 'WILDCARD', assetValue: 'CRITICAL', active: true, updatedAt: new Date() };
    const files = consoleBundle(target, null, [], { id: 'session', workspaceId: 'research_target', createdAt: new Date() });
    expect(JSON.parse(files['.agents/bughunter/policy.json'])).toMatchObject({ targetHost: 'example.test', mode: 'PROGRAM_PASSIVE', programScope: { rules: ['*.example.test'] } });
    expect(files['.codex/config.toml']).not.toContain('send_http1_request');
  });
});
describe('structured asset Recon → Research', () => {
  it('retains true scan provenance and HTTP metadata without invented status/versions', () => {
    const at = new Date('2026-11-02T00:00:00Z');
    const corpus = { ...researchRecon().reconCorpus, capturedAt: at.toISOString() };
    const raw = { id: 'scan', targetId: 'target', status: 'COMPLETED', outcome: 'PARTIAL', createdAt: at, startedAt: at, finishedAt: at, target: { host: 'program.invalid' }, reconCorpus: null, discoveries: [], logs: [],
      assetResults: { version: 1, scopeAssetId: 'asset', bounded: false, hosts: [{ hostname: 'app.example.test', capturedAt: at.toISOString(), corpus, dns: ['192.0.2.1'], ports: [{ port: 8443, state: 'open', serviceLabel: 'https-alt' }], http: [{ url: 'https://app.example.test/api/users', method: 'GET', statusCode: 401, contentType: 'application/json', observedAt: at.toISOString(), authenticationSchemes: ['bearer'] }] }] } };
    const runs = expandAssetReconRuns([raw]), scopeAssets = [{ id: 'asset', programId: 'program', originalValue: '*.example.test', normalizedValue: '*.example.test', format: 'WILDCARD_DOMAIN', type: 'API', assetValue: 'CRITICAL', active: true }];
    expect(runs[0].id).toBe('scan');
    const c = buildReconContext({ programId: 'program', targetId: 'target', scopeId: 'scope', generatedAt: at.toISOString(), runs, scopeAssets, inScope: () => true, activeSuggestionsAllowed: false });
    expect(c.endpoints.find(e => e.url.endsWith('/api/users'))).toMatchObject({ statusCode: 401, contentType: 'application/json', method: 'GET' });
    expect(c.observations.some(o => o.type === 'http-authentication')).toBe(true); expect(c.observations.some(o => o.type === 'dns-address')).toBe(true);
    expect(c.sources.every(s => s.scanId === 'scan')).toBe(true); expect(c.suggestions.find(s => s.asset.endsWith('/api/users'))).toMatchObject({ assetValue: 'CRITICAL', assetType: 'API', scopeAssetId: 'asset' });
    expect(c.technologies.every(t => !t.version)).toBe(true); expect(c.warnings.join(' ')).toContain('PARTIAL');
    expect(Buffer.byteLength(reconJson(compactReconContext(c)))).toBeLessThanOrEqual(RECON_SUMMARY_BYTES);
  });
  it('escapes Markdown data and produces ASCII-only attachment names', () => {
    expect(markdownText('Équipe | <script>\n# IGNORE')).toContain('Équipe \\| \\<script\\> \\#');
    expect(scopeFilename('asset', '../../équipe\r\nContent-Type: bad')).toBe('asset-equipe-content-type-bad-scope.md');
  });
});
