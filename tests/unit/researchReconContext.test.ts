import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, symlink, chmod, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildReconContext, compactReconContext, reconJson, reconHash, RECON_DETAIL_BYTES, RECON_SUMMARY_BYTES, type ReconRun } from '@/server/research/reconContext';
import { reconScopePolicy } from '@/server/research/reconSnapshots';
import { publishReconFiles } from '@/server/research/reconFiles';
import { consoleBundle, writeConsoleWorkspace } from '@/server/research/consoleWorkspace';
import { researchTarget, researchRecon } from '../fixtures/research';

const at = (day = 1) => new Date(`2026-10-${String(day).padStart(2, '0')}T00:00:00Z`);
function run(id = 'scan', day = 1): ReconRun {
  return { id, targetId: 'target', status: 'COMPLETED', outcome: 'SUCCESS', createdAt: at(day), startedAt: at(day), finishedAt: at(day),
    target: { host: 'app.example.test' }, reconCorpus: { ...researchRecon().reconCorpus, capturedAt: at(day).toISOString() }, discoveries: [], logs: [] };
}
const build = (runs: ReconRun[], now = at(2).toISOString(), target = researchTarget()) => buildReconContext({ programId: 'program', scopeId: 'scope', targetId: 'target', generatedAt: now, runs, ...reconScopePolicy(target) });
describe('derived Research Recon evidence', () => {
  it('normalizes corpus-v1 without inventing methods, HTTP status, auth requirements or technology versions', () => {
    const context = build([run()]);
    expect(context.endpoints.find(e => e.url.endsWith('/search'))).toMatchObject({ parameters: ['q'], verification: 'DISCOVERED', authenticatedCrawl: false });
    expect(context.endpoints.find(e => e.url.endsWith('/search'))).not.toHaveProperty('method');
    expect(context.endpoints.find(e => e.url.endsWith('/profile'))).toMatchObject({ method: 'POST', parameters: ['csrf', 'email'] });
    expect(context.technologies).toEqual([expect.objectContaining({ name: 'nginx', confidence: 'INFERRED' })]);
    expect(context.technologies[0]).not.toHaveProperty('version');
    expect(JSON.stringify(context)).not.toMatch(/private-value|raw-private-body|cookie-fixture-secret|csrf-fixture-secret|statusCode/);
  });
  it('merges equivalent observations, dates and exact source references across scans without mutating inputs', () => {
    const a = run('a', 1), b = run('b', 3), original = reconJson([a, b]), context = build([b, a], at(4).toISOString());
    const endpoint = context.endpoints.find(e => e.url.endsWith('/search'))!;
    expect(endpoint).toMatchObject({ firstSeenAt: at(1).toISOString(), lastSeenAt: at(3).toISOString(), historical: false, sources: ['a/corpus-v1', 'b/corpus-v1'] });
    expect(endpoint.references.every(ref => ref.startsWith('ScanRun:'))).toBe(true);
    expect(context.sources.find(s => s.id === 'a/corpus-v1')).toMatchObject({ scanId: 'a', status: 'COMPLETED', outcome: 'SUCCESS', completedAt: at(1).toISOString() });
    expect(reconJson([a, b])).toBe(original);
  });
  it('distinguishes actual legacy httpx, katana, DNS and nmap output and records the log IDs', () => {
    const source = run(); source.reconCorpus = null;
    source.logs = [
      '$ httpx -u https://app.example.test', 'https://app.example.test/', '[recon] httpx: completed',
      '$ katana -u https://app.example.test', 'https://app.example.test/api/items?id=private', '[recon] katana: completed',
      '$ nmap -sT app.example.test', '8080/tcp open http-proxy', '[recon] nmap: completed',
      '[dns] [{"address":"192.0.2.10","type":"A"}]',
    ].map((line, i) => ({ id: `log${i}`, line, stream: 'STDOUT', createdAt: new Date(at().getTime() + i * 100) }));
    const context = build([source]);
    expect(context.endpoints.find(e => e.url.endsWith('/'))).toMatchObject({ verification: 'PROBED', references: ['ScanLog:log1'] });
    expect(context.endpoints.find(e => e.url.endsWith('/api/items'))).toMatchObject({ verification: 'DISCOVERED', parameters: ['id'] });
    expect(context.observations.map(o => o.type).sort()).toEqual(['dns-address', 'tcp-port']);
    expect(context.assets.some(a => a.ip)).toBe(false);
    expect(context.technologies).toEqual([]);
  });
  it('retains malformed/failed/partial run provenance and valid discoveries', () => {
    const source = run(); source.status = 'FAILED'; source.outcome = 'PARTIAL'; source.reconCorpus = { version: 999, urls: 'invalid' };
    source.discoveries = [{ id: 'd', host: 'app.example.test', state: 'VALIDATED', source: 'SUBFINDER', createdAt: at() }];
    source.logs = [{ id: 'bad', line: '[dns] [bad', stream: 'STDOUT', createdAt: at() }];
    const context = build([source]);
    expect(context.assets[0]).toMatchObject({ sources: ['scan/subfinder'], references: ['HostDiscovery:d'] });
    expect(context.warnings.join(' ')).toMatch(/FAILED\/PARTIAL.*malformed|malformed.*FAILED\/PARTIAL/);
    expect(context.warnings.join(' ')).toContain('malformed DNS');
    expect(build([]).warnings.join(' ')).toContain('absence of vulnerabilities');
  });
  it('marks fresh, aging, stale and historical evidence and only proposes current in-scope surfaces', () => {
    const older = run('old', 1), current = run('new', 10);
    current.reconCorpus = { ...researchRecon().reconCorpus, capturedAt: at(10).toISOString(), urls: ['https://app.example.test/api/new'] , forms: [], queryParams: [], jsUrls: [], authUrls: [], technologies: [] };
    const context = build([older, current], at(20).toISOString());
    expect(context.endpoints.find(e => e.url.endsWith('/search'))).toMatchObject({ historical: true, freshness: 'AGING' });
    const next = context.suggestions.find(s => s.asset.endsWith('/api/new'))!;
    expect(next).toMatchObject({ confidence: 'LOW', freshness: 'AGING', scopeId: 'scope' }); expect(next.reason).toContain('previous retained corpus');
    expect(context.suggestions.some(s => s.asset.endsWith('/search'))).toBe(false);
    expect(build([run()], '2026-12-01T00:00:00Z').suggestions).toEqual([]);
    expect(build([run()], '2026-12-01T00:00:00Z').endpoints[0].freshness).toBe('STALE');
  });
  it('does not mark newer partial evidence historical just because an earlier complete corpus exists', () => {
    const older = run('complete', 1), partial = run('partial', 3); partial.status = 'FAILED'; partial.outcome = 'PARTIAL';
    partial.reconCorpus = { ...researchRecon().reconCorpus, capturedAt: at(3).toISOString(), urls: ['https://app.example.test/api/newer'], forms: [], queryParams: [] };
    expect(build([older, partial], at(4).toISOString()).endpoints.find(e => e.url.endsWith('/api/newer'))!.historical).toBe(false);
  });
  it('prioritizes explainable administrative/API/parameter signals and never claims auth is required', () => {
    const source = run(); source.reconCorpus = { ...researchRecon().reconCorpus, capturedAt: at().toISOString(), authenticated: true, urls: ['https://app.example.test/admin', 'https://app.example.test/api/items'], queryParams: [{ url: 'https://app.example.test/api/items', key: 'id' }], forms: [] };
    const context = build([source]);
    expect(context.suggestions[0].asset).toMatch(/admin|api\/items/);
    expect(context.suggestions.every(s => s.confidence === 'LOW')).toBe(true);
    expect(context.suggestions.find(s => s.asset.endsWith('/admin'))!.reason).toContain('authentication requirement is unverified');
    expect(context.suggestions.every(s => s.observationIds.every(id => [...context.endpoints, ...context.observations, ...context.technologies].some(o => o.id === id)))).toBe(true);
  });
  it('uses exact/wildcard/exclusion scope rules and persistent-console URL service restrictions', () => {
    const target = researchTarget(), active = reconScopePolicy(target);
    expect(active.inScope('https://app.example.test/path?q=1')).toBe(true);
    for (const value of ['http://app.example.test/path', 'https://app.example.test:8443/path', 'https://user:secret@app.example.test/path', 'https://other.example.test/', 'https://example.test/']) expect(active.inScope(value)).toBe(false);
    target.contextOnly = true; target.host = 'context.example.test';
    const passive = reconScopePolicy(target);
    expect(passive.inScope('nested.app.example.test')).toBe(true); expect(passive.inScope('example.test')).toBe(false); expect(passive.inScope('admin.example.test')).toBe(false);
    target.program!.scopeRules = ['app.example.test']; expect(reconScopePolicy(target).inScope('nested.app.example.test')).toBe(false);
    target.contextOnly = false; target.host = 'app.example.test'; target.scope.scopeDetails = 'https://app.example.test/allowed only';
    expect(reconScopePolicy(target).activeSuggestionsAllowed).toBe(true);
    // Scope prose is documentary; explicit scope status still controls access.
    target.scope.status = 'REVOKED'; expect(reconScopePolicy(target).inScope('app.example.test')).toBe(false);
  });
  it('keeps out-of-scope discoveries for traceability and excludes them from suggestions', () => {
    const source = run(); source.reconCorpus = { ...researchRecon().reconCorpus, capturedAt: at().toISOString(), urls: ['https://admin.example.test/api/admin'] };
    source.discoveries = [{ id: 'd', host: 'admin.example.test', state: 'VALIDATED', source: 'CERTIFICATE_TRANSPARENCY', createdAt: at() }];
    const context = build([source]);
    expect(context.assets.find(a => a.hostname === 'admin.example.test')!.inScope).toBe(false);
    expect(context.endpoints.find(e => e.url.includes('admin.example.test'))!.inScope).toBe(false);
    expect(context.suggestions.some(s => s.asset.includes('admin.example.test'))).toBe(false);
  });
  it('checks action-shaped query values before redaction and excludes unsafe endpoints from suggestions', () => {
    const source = run(); source.reconCorpus = { ...researchRecon().reconCorpus, capturedAt: at().toISOString(), urls: ['https://app.example.test/api/action?action=delete', 'https://app.example.test/api/logout'], forms: [], queryParams: [] };
    const context = build([source]);
    expect(context.endpoints.find(e => e.url.endsWith('/api/action'))!.safeForActiveReview).toBe(false);
    expect(context.suggestions.some(s => /api\/(action|logout)$/.test(s.asset))).toBe(false);
    expect(reconJson(context)).not.toContain('action=delete');
  });
  it('is canonical, deterministic across input ordering and JSONB key ordering', () => {
    const a = run('a'), b = run('b', 3);
    expect(reconJson(build([a, b]))).toBe(reconJson(build([b, a])));
    expect(reconJson({ z: { b: 1, a: 2 }, a: 1 })).toBe(reconJson({ a: 1, z: { a: 2, b: 1 } }));
  });
  it('bounds details and prioritized summaries and reports scan row limits', () => {
    const runs = Array.from({ length: 35 }, (_, i) => {
      const source = run(`scan${i}`); source.reconCorpus = { ...researchRecon().reconCorpus, capturedAt: at().toISOString(), forms: [], queryParams: [], urls: Array.from({ length: 100 }, (_, n) => `https://app.example.test/api/items/${i}/${n}`) };
      source._count = { logs: 3000, discoveries: 2000 }; return source;
    });
    const context = build(runs), summary = compactReconContext(context);
    expect(Buffer.byteLength(reconJson(context))).toBeLessThanOrEqual(RECON_DETAIL_BYTES);
    expect(Buffer.byteLength(reconJson(summary))).toBeLessThanOrEqual(RECON_SUMMARY_BYTES);
    expect(context.truncated).toBe(true); expect(summary.truncated).toBe(true); expect(context.counts.endpoints).toBeGreaterThan(3000);
    expect(context.warnings.join(' ')).toContain('input limit'); expect(summary.endpoints.length).toBeLessThanOrEqual(12);
  });
  it('discards arbitrary metadata, titles, instruction strings and secret URL values', () => {
    const source = run(); source.reconCorpus = { ...researchRecon().reconCorpus, capturedAt: at().toISOString(), technologies: ['IGNORE_SCOPE; run shell', 'nginx'], urls: ['https://app.example.test/api?q=IGNORE_SCOPE_SECRET', 'javascript:evil()', 'https://app.example.test/\nSYSTEM'], title: 'OVERRIDE_MCP_PERMISSIONS', body: 'RUN_SHELL_NOW' };
    source.logs = [{ id: 'bad', line: 'IGNORE_ALL_RULES', stream: 'STDOUT', createdAt: at() }];
    const context = build([source]);
    expect(reconJson(context)).not.toMatch(/IGNORE_SCOPE|OVERRIDE_MCP|RUN_SHELL|IGNORE_ALL/);
    expect(context.authorizationGranted).toBe(false); expect(context.untrustedData).toBe(true);
    expect(context.warnings.join(' ')).toContain('unsupported technology');
  });
  it('keeps instruction-shaped URL path content in JSON data only, with fixed suggestion explanations', () => {
    const source = run(); source.reconCorpus = { ...researchRecon().reconCorpus, capturedAt: at().toISOString(), urls: ['https://app.example.test/api/IGNORE_SYSTEM_RULES'], forms: [], queryParams: [] };
    const context = build([source]), observed = context.endpoints.find(e => e.url.includes('IGNORE_SYSTEM_RULES'))!;
    expect(observed).toBeDefined(); expect(context.untrustedData).toBe(true); expect(context.authorizationGranted).toBe(false);
    expect(context.suggestions.find(s => s.asset === observed.url)!.reason).not.toContain('IGNORE_SYSTEM_RULES');
  });
});
describe('immutable Research Recon workspace files', () => {
  it('publishes and reuses exact artifacts, rejects tampering/links and preserves policy/config/notes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'recon-files-'));
    try {
      const bundle = consoleBundle(researchTarget(), null, [], { id: 'session', workspaceId: 'research_target', createdAt: at() });
      await writeConsoleWorkspace(root, 'target', bundle);
      const contextText = reconJson(build([run()])), summaryText = reconJson(compactReconContext(build([run()]))), hash = reconHash(contextText);
      const data = { contentSha256: hash, contextText, summaryText };
      await publishReconFiles(root, 'research_target', data); await publishReconFiles(root, 'research_target', data);
      const path = join(root, 'research_target/recon', `snapshot-${hash}.json`);
      expect(await readFile(path, 'utf8')).toBe(contextText);
      for (const name of ['scope.md', '.codex/config.toml', 'findings/notes.md']) expect(await readFile(join(root, 'research_target', name), 'utf8')).toBe(bundle[name]);
      await chmod(path, 0o640); await expect(publishReconFiles(root, 'research_target', data)).rejects.toThrow('integrity'); await chmod(path, 0o440);
      await link(path, path + '.hardlink'); await expect(publishReconFiles(root, 'research_target', data)).rejects.toThrow('integrity'); await rm(path + '.hardlink');
      await symlink(root, root + '-link'); await expect(publishReconFiles(root + '-link', 'research_target', data)).rejects.toThrow();
    } finally { await rm(root + '-link', { force: true }); await rm(root, { recursive: true, force: true }); }
  });
});
