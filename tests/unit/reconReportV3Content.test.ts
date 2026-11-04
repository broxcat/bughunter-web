import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReconReportV3 } from '@/lib/reconReportV3';
import ReconReportV3Content from '@/components/ReconReportV3Content';
import { ReconSummaryUnavailable } from '@/components/ReconSummaryButton';
import { exportAuthSurfaces } from '@/server/recon/authExport';
import type { SafeAuthSurface } from '@/lib/authenticatedRecon';

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
  it('shows captured assessment mode and source counts as deterministic metadata, with an explicit analysis limit',()=>{
    const html=render(report({assessmentContext:{assessmentMode:'WHITE_BOX',authorizedSourceCount:2,sourceContentAvailable:false,sourceAnalysisPerformed:false,networkAuthorizationSource:'ScopeAsset',sourceAuthorizationSeparate:true}}));
    expect(html).toContain('White-box');expect(html).toContain('Authorized sources captured: 2');expect(html).toContain('Source-assisted analysis: Not performed');expect(html).toContain('network authorization');
    expect(render()).toContain('Legacy / mode not captured');expect(render()).toContain('Unknown (historical run)');
  });
  it('renders observed context differences and missing comparisons as facts, with opaque personas and no authorization finding',()=>{
    const source:SafeAuthSurface={scanRunId:'context-run',legacy:false,contexts:[{contextKey:'ANONYMOUS',mode:'ANONYMOUS',label:'Anonymous',state:'MAPPED'},{contextKey:'AUTH_A',mode:'AUTHENTICATED',label:'Private Alice',persona:'ADMIN',state:'MAPPED'},{contextKey:'AUTH_B',mode:'AUTHENTICATED',label:'Private Bob',persona:'private-bob@example.test',state:'MAPPED'}],observations:[],surfaceVisibility:[],totals:{public:0,authenticatedOnly:0,sharedAuthenticated:0,contextDifferentials:0,observations:0},warnings:[]};
    source.observations=['ANONYMOUS','AUTH_A','AUTH_B'].map((contextKey,index)=>({id:'observation-'+index,contextKey,contextType:index?'AUTHENTICATED':'ANONYMOUS',canonicalKey:'GET:'+('a'.repeat(64)),url:'https://app.example.test/dashboard',method:'GET',statusCode:[401,200,403][index],contentType:'text/html',redirect:null,redirectPattern:null,responseClass:index===1?'CONTENT':'DENIED',observedAt:'2026-11-04T00:00:00Z',source:'private-source'}));
    source.observations.push({...source.observations[1],id:'single-observation',canonicalKey:'GET:'+('b'.repeat(64)),url:'https://app.example.test/profile'});
    const html=render(report({authenticatedRecon:exportAuthSurfaces([source])}));
    for(const text of ['Observed authentication contexts','Authenticated context 1','declared persona: ADMIN','Anonymous: 401','Authenticated context 1: 200','Authenticated context 2: 403','Not observed / unknown','1 observed context differentials','not proof of broken authorization','operator-declared','observation-1'])expect(html).toContain(text);
    for(const privateValue of ['Private Alice','Private Bob','private-bob@','private-source'])expect(html).not.toContain(privateValue);
    expect(render()).toContain('Historical context not captured; anonymous access is unknown.');
  });
  it('separates application-owned facts and coverage from the AI interpretation', () => {
    const html = render();
    expect(html.indexOf('Recon facts')).toBeLessThan(html.indexOf('AI synthesis'));
    for (const text of ['Équipe application', 'HTTP endpoint', 'artifact-http-1', 'ScanRun:fixture:httpx', '43 static assets summarized', 'The observed login surface', 'Recon coverage', 'Partial', 'Completed with a fallback']) expect(html).toContain(text);
    expect(html).not.toContain('<pre'); expect(html).not.toContain('"version":3');
  });
  it('shows a human ready-with-warnings state without raw schema diagnostics', () => {
    const html = render(report({ narrativeStatus: 'RECOVERED', warnings: [{ code: 'UNKNOWN_EVIDENCE_REF', path: 'webSurface.0', evidenceRefs: ['unknown'], message: 'ZodError: [{"code":"invalid_type","expected":"array"}]' }] }));
    expect(html).toContain('Report ready with warnings'); expect(html).toContain('HTTP endpoint'); expect(html).toContain('A login route was observed');
    expect(html).not.toContain('ZodError'); expect(html).not.toContain('invalid_type'); expect(html).not.toContain('UNKNOWN_EVIDENCE_REF');
  });
  it('explains an unsupported OpenRouter model without displaying raw provider errors',()=>{
    const value=report({narrativeStatus:'FACTUAL_ONLY',narrativeFailure:'FAILED_PROVIDER',warnings:[{code:'STRUCTURED_OUTPUT_UNSUPPORTED',path:'provider',evidenceRefs:[],message:'RAW_PROVIDER_BODY_WITH_PRIVATE_DETAILS'}]});
    const html=renderToStaticMarkup(createElement(ReconReportV3Content,{report:value,provider:'OPENROUTER'}));
    expect(html).toContain('This OpenRouter model or route');expect(html).toContain('does not support the required structured output');expect(html).toContain('Recon facts remain available');expect(html).not.toContain('RAW_PROVIDER_BODY');
  });
  it.each([
    ['FAILED_PROVIDER_CONFIGURATION', 'captured AI provider configuration is unavailable'],
    ['FAILED_PROVIDER', 'AI provider did not return a usable response'],
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
  it('renders populated categories directly with coherent counts and no empty bullet', () => {
    const value = report(), rows = value.factual.sections[0].rows;
    rows[0].label = 'endpoint';
    rows.push({ ...rows[0], label: 'unknown', value: '', details: {} });
    const html = render(value);
    expect(html).toContain('Web Surface (1)'); expect(html).toContain('1 factual entries');
    expect(html).toContain('data-fact-primary="true"'); expect(html).toContain('GET https://'); expect(html).toContain('— 200');
    expect(html).not.toContain('<summary class="cursor-pointer'); expect(html.match(/data-fact-row=/g)).toHaveLength(1);
    expect(html).not.toMatch(/<li[^>]*>\s*-?\s*<\/li>/);
  });
  it('exposes recorded fallback status and HTTP diagnostics without leaking provider data', () => {
    const value = report({ narrativeStatus: 'FACTUAL_ONLY', narrativeFailure: 'FAILED_PROVIDER', generation: { attempts: [{ httpStatus: 400, providerErrorCode: 'PROVIDER_HTTP_ERROR', body: 'PRIVATE_BODY', message: 'PRIVATE_TOKEN' }] } });
    const html = render(value);
    for (const expected of ['AI synthesis: FALLBACK', 'FAILED_PROVIDER', 'HTTP 400', 'Assessment Overview', 'Recon coverage', 'Methodology', 'Limitations']) expect(html).toContain(expected);
    expect(html).not.toContain('PRIVATE_'); expect(html).not.toContain('PROVIDER_HTTP_ERROR');
    expect(render()).toContain('AI synthesis: READY');
    expect(render(report({ narrativeStatus: 'RECOVERED' }))).toContain('AI synthesis: READY_WITH_WARNINGS');
  });
});
