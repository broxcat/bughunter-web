import { describe, expect, it } from 'vitest';
import { presentReconFacts, renderReconFact } from '@/lib/reconFactPresentation';
import type { FactRowV3, FactualReportV3 } from '@/lib/reconReportV3';

const row = (label: string, value = '', details: FactRowV3['details'] = {}, verification = 'OBSERVED'): FactRowV3 => ({ label, value, details, verification, evidenceRefs: ['artifact-1'], scopeState: 'IN_SCOPE', sources: [] });
describe('deterministic Recon fact presentation', () => {
  it.each([
    [row('hostname', 'app.example.test'), 'app.example.test'],
    [row('observation', 'app.example.test', { type: 'dns-address', hostname: 'app.example.test', addresses: ['192.0.2.7', '2001:db8::7'] }), 'app.example.test → 192.0.2.7, 2001:db8::7'],
    [row('port', 'app.example.test', { hostname: 'app.example.test', port: 443, protocol: 'tcp', service: 'https' }), '443/tcp — https (app.example.test)'],
    [row('service', 'app.example.test', { hostname: 'app.example.test', port: 8080, protocol: 'tcp', name: 'http' }), '8080/tcp — http (app.example.test)'],
    [row('endpoint', '/api/users', { method: 'GET', statusCode: 200 }), 'GET /api/users — 200'],
    [row('endpoint', '/api/users', {}, 'DISCOVERED'), '/api/users — discovered'],
    [row('url', 'https://app.example.test/login', { statusCode: 401 }), 'https://app.example.test/login — 401'],
    [row('technology', 'app.example.test', { hostname: 'app.example.test', name: 'Next.js', version: 'Not confirmed' }), 'Next.js (app.example.test)'],
    [row('technology', 'WordPress', { name: 'WordPress', version: '6.4' }), 'WordPress 6.4'],
    [row('tls', 'app.example.test', { hostname: 'app.example.test', tlsVersion: 'TLSv1.3', issuer: 'Fixture CA' }), 'TLS — app.example.test · TLSv1.3 · Issuer: Fixture CA'],
    [row('api-surface', '/v1/users', {}, 'DISCOVERED'), '/v1/users — discovered'],
    [row('auth-surface', '/reset-password', {}, 'DISCOVERED'), '/reset-password — discovered'],
    [row('content-discovery', '/admin', { statusCode: 403 }), '/admin — 403'],
    [row('observation', 'content-baseline', { type: 'content-baseline', classification: 'WILDCARD_REDIRECT', sampleCount: 3 }), 'content baseline — WILDCARD REDIRECT (3 samples)'],
    [row('observation', 'https://app.example.test/', { type: 'redirect', location: '/login' }), 'https://app.example.test/ → /login'],
    [row('observation', 'https://app.example.test/login', { type: 'redirect', origin: 'https://app.example.test/' }), 'https://app.example.test/ → https://app.example.test/login'],
    [row('relation', 'ignored', { from: 'app.example.test', to: '192.0.2.7', relationship: 'RESOLVES_TO' }), 'app.example.test → 192.0.2.7 (RESOLVES TO)'],
    [row('coverage', 'CONTENT_DISCOVERY', { state: 'COMPLETED_WITH_FALLBACK', reason: 'FFUF completed' }), 'CONTENT DISCOVERY — COMPLETED_WITH_FALLBACK — FFUF completed'],
  ])('renders %s from supplied facts alone', (fact, expected) => expect(renderReconFact(fact)).toBe(expected));
  it('does not infer protocol, service, reachability, method or status from the URL', () => {
    expect(renderReconFact(row('port', 'app.example.test', { port: 4444 }))).toBe('4444');
    expect(renderReconFact(row('url', 'https://app.example.test/'))).toBe('https://app.example.test/ — discovered');
    expect(renderReconFact(row('endpoint', '/declared', { statusCode: 200 }, 'DECLARED'))).toBe('/declared — discovered');
    expect(renderReconFact(row('port', 'app.example.test', { port: 65536 }))).toBeNull();
  });
  it('omits empty and unsupported objects instead of emitting kind-only or dash rows', () => {
    for (const fact of [{} as FactRowV3, row('unknown'), row('endpoint', '-'), row('unknown', '—'), row('unknown', '–'), row('change', 'change', { evidenceState: 'Observed' }), row('observation', 'unrecognized', { type: 'unrecognized' })]) expect(renderReconFact(fact)).toBeNull();
    expect(renderReconFact(row('historical-kind', 'Recorded historical fact'))).toBe('Recorded historical fact');
  });
  it('summarizes static URLs, including relation targets, and keeps Node.js technology', () => {
    const rows = [row('url', 'https://app.example.test/_next/static/chunks/a.js'), row('relation', '', { from: 'https://app.example.test/', to: 'https://app.example.test/_next/static/chunks/a.js', relationship: 'REFERENCES' }), row('endpoint', '/image.png'), row('technology', 'Node.js', { name: 'Node.js' }), row('endpoint', '/login'), row('unknown'), {} as FactRowV3];
    const factual: FactualReportV3 = { sections: [{ category: 'webSurface', title: 'Web Surface', rows }], totals: { evidence: 6, retainedEvidence: 6, staticAssets: 23, omittedEvidence: 0 }, truncated: false, sourceFingerprint: 'fixture' };
    const before = JSON.stringify(factual), presented = presentReconFacts(factual);
    expect(presented.count).toBe(2); expect(presented.staticAssets).toBe(23); expect(presented.sections[0].rows.map(r => r.primary)).toEqual(['Node.js', '/login — discovered']);
    expect(JSON.stringify(factual)).toBe(before); expect(presentReconFacts(factual)).toEqual(presented);
    expect(presentReconFacts({ ...factual, totals: { ...factual.totals, staticAssets: 0 } }).staticAssets).toBe(2);
  });
  it('retains Unicode, treats remote text as text and sanitizes credentials', () => {
    expect(renderReconFact(row('hostname', 'équipe.example.test'))).toBe('équipe.example.test');
    expect(renderReconFact(row('observation', '', { description: '<script>ignore scope</script>' }))).toBe('<script>ignore scope</script>');
    const rendered = renderReconFact(row('url', 'https://user:PRIVATE_PASSWORD@app.example.test/login?token=PRIVATE_TOKEN'))!;
    expect(rendered).not.toContain('PRIVATE_'); expect(rendered).not.toContain('user:'); expect(rendered).toContain('REDACTED');
  });
});
