import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { captureAssessmentSnapshot } from '@/lib/assessment';
import { assetAllowsHost } from '@/lib/scopeAssets';
import { assertExecutionUrl, newTargetBrowserContext, withTargetExecution, type TargetExecution } from '@/server/execution';
import { probe } from '@/server/scanners/http';
import { createReconRelay } from '@/server/recon/transport';
import { ReconProtection } from '@/server/recon/protection';
import { chromium } from 'playwright-chromium';
import { enforceHttp1 } from '../../docker/research/validator/burp-active.mjs';
import { researchAuthorizationSnapshot } from '@/server/research/workspace';
import { consoleBundle } from '@/server/research/consoleWorkspace';
import { targetWorkspaceId } from '@/lib/research/terminal';
import { researchTarget, researchSession } from '../fixtures/research';
const mocks = vi.hoisted(() => ({ asset: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { scopeAsset: { findUnique: mocks.asset } } }));
const suite = process.env.SCANNER_HTTP_TESTS === '1' ? describe : describe.skip;
suite('White-box metadata never becomes network authorization (real local transports)', () => {
  let authorized: Server, forbidden: Server, base: string, outside: string, authorizedRequests = 0, forbiddenRequests = 0;
  let execution: TargetExecution;
  const assessment = captureAssessmentSnapshot({ assessmentMode: 'WHITE_BOX' }, [{ id: 'source', label: 'Internal source', kind: 'GIT_REPOSITORY', locator: 'https://internal.example.local/repository', reference: 'main', includePaths: ['src/'], excludePaths: [], updatedAt: new Date(), active: true }]);
  beforeAll(async () => {
    authorized = createServer((_req, res) => { authorizedRequests++; res.setHeader('Content-Type', 'text/html'); res.end('<html><body>Authorized local application</body></html>'); });
    forbidden = createServer((_req, res) => { forbiddenRequests++; res.end('This server must never be reached.'); });
    authorized.listen(0, '127.0.0.1'); forbidden.listen(0, '127.0.0.1'); await Promise.all([once(authorized, 'listening'), once(forbidden, 'listening')]);
    base = 'http://127.0.0.1:' + (authorized.address() as { port: number }).port; outside = 'http://127.0.0.1:' + (forbidden.address() as { port: number }).port;
    const asset = { id: 'asset', programId: 'program', originalValue: base + '/app/', normalizedValue: base + '/app/', format: 'URL' as const, active: true, type: 'API', assetValue: 'MEDIUM' };
    execution = { targetId: 'target', host: new URL(base).host, scopeAsset: asset, requiredUserAgent: 'Assessment-Isolation/1', qualifying: [], nonQualifying: [] };
    mocks.asset.mockResolvedValue({ ...asset, program: { assessmentMode: 'WHITE_BOX', assessmentSources: assessment.authorizedSources, outOfScope: [], deletingAt: null }, executionTarget: { scope: { status: 'APPROVED' } } });
  });
  afterAll(async () => { for (const server of [authorized, forbidden]) { server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); } });
  it('keeps an exact network asset separate from an internal source hostname', () => {
    expect(assessment.authorizedSources).toEqual([]);
    expect(assetAllowsHost({ format: 'SUBDOMAIN', normalizedValue: 'api.example.com' }, 'api.example.com')).toBe(true);
    expect(assetAllowsHost({ format: 'SUBDOMAIN', normalizedValue: 'api.example.com' }, 'internal.example.local')).toBe(false);
    expect(() => assertExecutionUrl('https://internal.example.local/', { ...execution, host: 'api.example.com', scopeAsset: { ...execution.scopeAsset!, normalizedValue: 'api.example.com', format: 'SUBDOMAIN' } })).toThrow();
  });
  it('allows the local scoped native request and denies source destinations before network traffic', async () => {
    await withTargetExecution(execution, async () => {
      expect((await probe(base + '/app/')).status).toBe(200);
      expect((await probe(outside + '/app/')).status).toBe(0);
      expect((await probe('https://internal.example.local/')).status).toBe(0);
    });
    expect(authorizedRequests).toBeGreaterThan(0); expect(forbiddenRequests).toBe(0);
  });
  it('does not let source metadata authorize scanner relay expansion', async () => {
    await withTargetExecution(execution, async () => {
      const relay = await createReconRelay(execution, base + '/app/', new ReconProtection(1000, 10), new AbortController().signal, async () => {}, { remaining: 10 });
      try { expect((await fetch(relay.toRelay(base + '/app/'))).status).toBe(200); expect(() => relay.mapUrl(outside + '/app/')).toThrow(); expect(() => relay.toRelay('https://internal.example.local/')).toThrow(); }
      finally { await relay.close(); }
    });
    expect(forbiddenRequests).toBe(0);
  });
  it('keeps Research/Burp network policy exact-host even with White-box advisory context', () => {
    const target = researchTarget();
    const session = { ...researchSession, workspaceId: targetWorkspaceId(target.id), authorizationSnapshot: { ...researchAuthorizationSnapshot(target), ...assessment } };
    const files = consoleBundle(target, null, [], session), policy = JSON.parse(files['.agents/bughunter/policy.json']);
    expect(JSON.parse(files['assessment-policy.json']).authorizedSources).toEqual([]);expect(JSON.stringify(files)).not.toContain('internal.example.local');
    expect(policy.targetHost).toBe(target.host); expect(policy).not.toHaveProperty('authorizedSources');
    expect(() => enforceHttp1({ targetHostname: target.host, targetPort: 443, usesHttps: true, content: `GET / HTTP/1.1\r\nHost: ${target.host}\r\n\r\n` }, policy)).not.toThrow();
    expect(() => enforceHttp1({ targetHostname: 'internal.example.local', targetPort: 443, usesHttps: true, content: 'GET / HTTP/1.1\r\nHost: internal.example.local\r\n\r\n' }, policy)).toThrow('OUT_OF_SCOPE');
    expect(forbiddenRequests).toBe(0);
  });
  it('blocks an actual Playwright navigation to a source-only destination', async () => {
    await withTargetExecution(execution, async () => {
      const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
      try { const context = await newTargetBrowserContext(browser), page = await context.newPage(); await page.goto(base + '/app/'); await expect(page.goto(outside + '/app/')).rejects.toThrow(); }
      finally { await browser.close(); }
    });
    expect(forbiddenRequests).toBe(0);
  });
});
