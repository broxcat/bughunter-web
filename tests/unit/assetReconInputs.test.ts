import { describe, expect, it } from 'vitest';
import { expandAssetReconRuns } from '@/server/research/reconInputs';
import { buildReconContext, reconJson, type ReconRun } from '@/server/research/reconContext';
import { researchRecon } from '../fixtures/research';

const at = new Date('2026-11-02T00:00:00Z');
function run(): ReconRun & { assetResults?: unknown } {
  return { id: 'original-scan', targetId: 'wildcard-target', status: 'COMPLETED', outcome: 'PARTIAL', createdAt: at, startedAt: at, finishedAt: at,
    target: { host: '*.example.test' }, reconCorpus: null, logs: [], discoveries: [
      { id: 'enriched', host: 'app.example.test', source: 'SUBFINDER', state: 'VALIDATED', createdAt: at },
      { id: 'unprobed', host: 'unprobed.example.test', source: 'CERTIFICATE_TRANSPARENCY', state: 'VALIDATED', createdAt: at },
    ], _count: { discoveries: 2, logs: 0 } };
}
const build = (source: ReturnType<typeof run>) => buildReconContext({ programId: 'program', scopeId: 'scope', targetId: 'wildcard-target', generatedAt: at.toISOString(),
  runs: expandAssetReconRuns([source]), activeSuggestionsAllowed: false, inScope: () => true });

describe('per-asset evidence inventory and archive provenance', () => {
  it('retains non-enriched discoveries beside per-host evidence without inventing source scans', () => {
    const source = run(); source.assetResults = { version: 1, scopeAssetId: 'asset', bounded: true, hosts: [
      { hostname: 'app.example.test', capturedAt: at.toISOString(), dns: ['192.0.2.1'], http: [], ports: [], corpus: { ...researchRecon().reconCorpus, capturedAt: at.toISOString() } },
    ] };
    const context = build(source);
    expect(context.assets.find(a => a.hostname === 'unprobed.example.test')).toMatchObject({ verification: 'DISCOVERED', references: ['HostDiscovery:unprobed'] });
    expect(context.assets.find(a => a.hostname === 'app.example.test')).toBeDefined();
    expect(new Set(context.sources.map(s => s.scanId))).toEqual(new Set(['original-scan']));
    expect(context.warnings.join(' ')).toContain('unprobed discoveries');
  });
  it('retains archive URLs even when no host was enriched and never proposes them as live surfaces', () => {
    const source = run(); source.assetResults = { version: 1, scopeAssetId: 'asset', bounded: false, hosts: [], historicalUrls: ['https://app.example.test/api/archive?token=SECRET'] };
    const context = build(source);
    expect(context.endpoints[0]).toMatchObject({ url: 'https://app.example.test/api/archive', historical: true, verification: 'DISCOVERED', sources: ['original-scan/gau'] });
    expect(context.observations[0].description).toContain('original observation date are unknown');
    expect(context.suggestions).toEqual([]); expect(reconJson(context)).not.toContain('SECRET');
  });
  it('explains observed authentication priority using exact endpoint and challenge provenance', () => {
    const source = run(); source.target.host = 'app.example.test'; source.httpObservations = [{ url: 'https://app.example.test/private', method: 'GET', statusCode: 401, contentType: 'text/html', observedAt: at.toISOString(), authenticationSchemes: ['bearer'] }];
    const context = build(source), suggestion = context.suggestions.find(s => s.asset.endsWith('/private'))!;
    expect(suggestion.reason).toContain('HTTP authentication challenge observed');
    expect(suggestion.observationIds).toHaveLength(2); expect(suggestion.sources).toEqual(['original-scan/asset-http']);
    expect(suggestion.confidence).toBe('LOW'); expect(suggestion.reason).toContain('requires verification');
  });
});
