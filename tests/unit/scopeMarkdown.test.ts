import { describe, expect, it } from 'vitest';
import { renderScopeMarkdown, SCOPE_MARKDOWN_BYTES } from '@/server/scopeMarkdown';
type Brief = Parameters<typeof renderScopeMarkdown>[0];
function fixture(): Brief {
  const at = new Date('2026-11-02T00:00:00Z');
  return { program: { id: 'target', companyName: 'Équipe | **scope**', platform: null, programUrl: null, requiredUserAgent: 'Fixture/1', rulesOfEngagement: null, scopeRules: ['*.example.test'], outOfScope: ['excluded.example.test'], updatedAt: at },
    assets: [{ id: 'low', programId: 'target', originalValue: 'low.example.test', normalizedValue: 'low.example.test', format: 'SUBDOMAIN', type: 'WEB_APPLICATION', assetValue: 'LOW', active: true, createdAt: at, updatedAt: at }, { id: 'critical', programId: 'target', originalValue: '*.example.test', normalizedValue: '*.example.test', format: 'WILDCARD_DOMAIN', type: 'WILDCARD', assetValue: 'CRITICAL', active: true, createdAt: at, updatedAt: at }], contexts: new Map(), runs: new Map(), previousResearch: new Map(), generatedAt: at.toISOString(), bounded: false };
}
describe('deterministic asset and Target mission briefs', () => {
  it('contains version, timestamp, IDs, authorization, missing-data labels and a data-only safety boundary', () => {
    const text = renderScopeMarkdown(fixture(), 'critical');
    for (const value of ['# Bug Bounty Scope Context', 'Format version: 1', '2026-11-02', 'Asset ID: critical', 'Target ID: target', 'No data collected yet.', 'apex, neighbours and excluded hosts are not authorized', 'LLM Safety Instructions', 'SHA256:']) expect(text).toContain(value);
    expect(text).toContain('Équipe \\| \\*\\*scope\\*\\*');
  });
  it('orders Target assets by user value deterministically regardless of input order', () => {
    const brief = fixture(), a = renderScopeMarkdown(brief), b = renderScopeMarkdown({ ...brief, assets: [...brief.assets].reverse() });
    expect(a).toBe(b); expect(a.indexOf('Asset ID: critical')).toBeLessThan(a.indexOf('Asset ID: low'));
    expect(a).toContain('## Scope Summary'); expect(a).toContain('## Research Methodology');
  });
  it('bounds very large exports at complete section boundaries and retains provenance and safety notes', () => {
    const brief = fixture(), item = brief.assets[0]; brief.bounded = true;
    brief.assets = Array.from({ length: 1000 }, (_, i) => ({ ...item, id: `asset${i}`, normalizedValue: `https://app.example.test/${String(i).padStart(5, '0')}/${'a'.repeat(1900)}`, originalValue: 'https://app.example.test/', format: 'URL' }));
    const text = renderScopeMarkdown(brief); expect(Buffer.byteLength(text)).toBeLessThanOrEqual(SCOPE_MARKDOWN_BYTES); expect(text).toContain('Export limit'); expect(text).toContain('LLM Safety Instructions'); expect(text).toContain('Target ID: target'); expect(text).toContain('Asset IDs');
    expect((text.match(/^```/gm) ?? []).length % 2).toBe(0);
  });
});
