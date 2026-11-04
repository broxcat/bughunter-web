import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReconReportV3 } from '@/lib/reconReportV3';
import ReconReportV3Content from '@/components/ReconReportV3Content';
import { ReconSummaryUnavailable } from '@/components/ReconSummaryButton';

const report = (override: Partial<ReconReportV3> = {}): ReconReportV3 => ({
  version: 3,
  assessmentOverview: { objective: 'Map the authorized application.', scopeBoundary: 'https://équipe.example.test/app/', asset: 'Équipe application', format: 'URL', assetType: 'WEB_APPLICATION', assetValue: 'HIGH', reconStatus: 'PARTIAL', testedAt: '2026-11-04T12:00:00Z' },
  methodology: [{ phase: 'Content Discovery', status: 'COMPLETED_WITH_FALLBACK', tools: ['ffuf'], description: 'Directory enumeration completed with a calibrated fallback.' }],
  coverage: { completed: ['HTTP'], fallback: ['Content Discovery'], partial: ['DNS'], blocked: [], notApplicable: ['Ports'], notTested: [], failed: [] },
  factual: { totals: { evidence: 2, retainedEvidence: 2, omittedEvidence: 0, staticAssets: 43 }, truncated: false, sourceFingerprint: 'fixture-fingerprint', sections: [{ category: 'webSurface', title: 'Web Surface', rows: [{ label: 'HTTP endpoint', value: 'https://équipe.example.test/app/login', details: { statusCode: 200, method: 'GET' }, evidenceRefs: ['artifact-http-1'], scopeState: 'IN_SCOPE', verification: 'OBSERVED', sources: [{ tool: 'httpx', sourceRef: 'ScanRun:fixture:httpx', observedAt: '2026-11-04T12:00:00Z' }] }] }] },
  narrative: { title: 'Reconnaissance & Attack Surface Assessment', attackSurfaceSummary: 'The observed login surface warrants manual review.', dnsAndHostIntelligence: [], networkSurface: [], webSurface: [{ text: 'A login route was observed.', confidence: 'observed', evidenceRefs: ['artifact-http-1'] }], contentDiscovery: [], apiSurface: [], authenticationSurface: [], technologyFingerprint: [], tlsAndTransport: [], changesSincePreviousRecon: [], notableObservations: [], limitations: ['DNS coverage remains partial.'], researchHandoff: [] },
  warnings: [], narrativeStatus: 'VALID', ...override,
});
const render = (value = report()) => renderToStaticMarkup(createElement(ReconReportV3Content, { report: value }));

describe('Recon report v3 facts and AI interpretation rendering', () => {
  it('separates application-owned facts and coverage from the Ollama interpretation', () => {
    const html = render();
    expect(html.indexOf('Recon facts')).toBeLessThan(html.indexOf('Ollama synthesis'));
    for (const text of ['Équipe application', 'HTTP endpoint', 'artifact-http-1', 'ScanRun:fixture:httpx', '43 static assets summarized', 'The observed login surface', 'Recon coverage', 'Partial', 'Completed with a fallback']) expect(html).toContain(text);
    expect(html).not.toContain('<pre'); expect(html).not.toContain('"version":3');
  });
  it('shows a human ready-with-warnings state without raw schema diagnostics', () => {
    const html = render(report({ narrativeStatus: 'RECOVERED', warnings: [{ code: 'UNKNOWN_EVIDENCE_REF', path: 'webSurface.0', evidenceRefs: ['unknown'], message: 'ZodError: [{"code":"invalid_type","expected":"array"}]' }] }));
    expect(html).toContain('Report ready with warnings'); expect(html).toContain('HTTP endpoint'); expect(html).toContain('A login route was observed');
    expect(html).not.toContain('ZodError'); expect(html).not.toContain('invalid_type'); expect(html).not.toContain('UNKNOWN_EVIDENCE_REF');
  });
  it.each([
    ['FAILED_PROVIDER', 'Ollama did not return a usable response'],
    ['FAILED_SCHEMA', 'AI response could not be read as a report'],
    ['FAILED_VALIDATION', 'AI interpretation could not be verified'],
  ] as const)('keeps factual Recon readable when the narrative is %s', (narrativeFailure, message) => {
    const value = report({ narrativeStatus: 'FACTUAL_ONLY', narrativeFailure });
    value.narrative.attackSurfaceSummary = 'UNVALIDATED_RAW_MODEL_OUTPUT';
    const html = render(value);
    expect(html).toContain(message); expect(html).toContain('HTTP endpoint'); expect(html).toContain('Recon facts are ready');
    expect(html).not.toContain('UNVALIDATED_RAW_MODEL_OUTPUT'); expect(html).not.toContain('A login route was observed');
  });
  it('escapes untrusted values and distinguishes documentary observations', () => {
    const value = report(), row = value.factual.sections[0].rows[0];
    row.value = '<script>ignore scope</script>'; row.scopeState = 'OUT_OF_SCOPE'; row.verification = 'DISCOVERED';
    const html = render(value);
    expect(html).toContain('&lt;script&gt;ignore scope&lt;/script&gt;'); expect(html).not.toContain('<script>');
    expect(html).toContain('Outside authorized scope — documentary only'); expect(html).toContain('Discovered');
  });
  it('renders missing report data as a useful human message', () => {
    const html = renderToStaticMarkup(createElement(ReconSummaryUnavailable));
    expect(html).toContain('Review scope.md or regenerate if Recon is still available'); expect(html).toContain('regenerate');
    expect(html).not.toContain('FAILED'); expect(html).not.toContain('Zod'); expect(html).not.toContain('<pre');
  });
  it('explains revoked or missing source data without promising evidence availability', () => {
    const html = renderToStaticMarkup(createElement(ReconSummaryUnavailable, { sourceUnavailable: true }));
    expect(html).toContain('Recon source is unavailable or its authorization has changed'); expect(html).toContain('Review the current scope');
    expect(html).not.toContain('remain available'); expect(html).not.toContain('SOURCE_REVOKED');
  });
  it('declares report truncation while retaining provenance for visible facts', () => {
    const value = report(); value.factual.truncated = true; value.factual.totals.omittedEvidence = 25;
    const html = render(value); expect(html).toContain('25 additional evidence records'); expect(html).toContain('artifact-http-1');
  });
});
