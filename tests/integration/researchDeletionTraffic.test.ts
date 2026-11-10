import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { runInThisContext } from 'node:vm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright-chromium';
import { consolePolicySchema } from '@/lib/research/consolePolicy';
import { researchTrafficCapability } from '@/server/research/researchTraffic';
import { acquireResearchTraffic } from '../../docker/research/validator/program-traffic.mjs';
import { sendViaBurpProxy } from '../../docker/research/validator/burp-transport.mjs';
const browserScope = createRequire(import.meta.url)('../../docker/research/validator/playwright-scope.cjs').default;
const db = process.env.TEST_DATABASE_URL, redis = process.env.TEST_EXECUTION_REDIS_URL;
const schema = 'research_delete_' + randomUUID().replaceAll('-', '');

describe.skipIf(!db || !redis)('open Research console after SQL deletion, before any garbage collection', () => {
  let p: PrismaClient, targetServer: Server, proxy: Server, base: string, ownerId: string;
  let POST: typeof import('@/app/api/internal/research-traffic/route').POST;
  let hits = 0, proxyHits = 0;
  const authResults: number[] = [];
  const nativeGlobal = runInThisContext('globalThis');
  let restoreNativeFetch: (() => void) | undefined;
  beforeAll(async () => {
    const url = new URL(db!); url.searchParams.set('schema', schema); process.env.DATABASE_URL = url.href;
    vi.stubEnv('REDIS_URL', redis!); vi.stubEnv('AUTH_SECRET', 'research-deletion-local-fixture');
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
    ({ prisma: p } = await import('@/lib/prisma')); ({ POST } = await import('@/app/api/internal/research-traffic/route'));
    ownerId = (await p.user.create({ data: { email: randomUUID() + '@example.test' } })).id;
    targetServer = createServer((_req, response) => { hits++; response.end('<h1>Controlled target</h1>'); });
    await new Promise<void>(resolve => targetServer.listen(0, '127.0.0.1', resolve));
    const port = (targetServer.address() as { port: number }).port; base = 'http://app.example.test:' + port;
    proxy = createServer((req, res) => {
      proxyHits++;
      const remote = new URL(req.url!);
      if (remote.origin !== base) { res.writeHead(403).end(); return; }
      const forward = httpRequest(new URL(remote.pathname + remote.search, 'http://127.0.0.1:' + port), { method: req.method, headers: req.headers }, upstream => {
        res.writeHead(upstream.statusCode!, upstream.headers); upstream.pipe(res);
      });
      forward.on('error', () => res.writeHead(502).end()); req.pipe(forward);
    });
    proxy.on('connect', (req, socket, head) => {
      proxyHits++;
      if (req.url !== 'app.example.test:' + port) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
      const upstream = connect(port, '127.0.0.1', () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        socket.pipe(upstream); upstream.pipe(socket);
      });
      socket.on('error', () => upstream.destroy()); upstream.on('error', () => socket.destroy());
      socket.on('close', () => upstream.destroy()); upstream.on('close', () => socket.destroy());
    });
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
    vi.stubEnv('BURP_PROXY_HOST', '127.0.0.1'); vi.stubEnv('BURP_PROXY_PORT', String((proxy.address() as { port: number }).port));
    // Only adapt the fixed Docker hostname to the actual application handler.
    // DB authorization, Redis admission, curl proxy and browser traffic are real.
    const nativeFetch = globalThis.fetch;
    const bridgedFetch = async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) !== 'http://web:3000/api/internal/research-traffic') return nativeFetch(input, init);
      const response = await POST(new Request(String(input), init)); authResults.push(response.status); return response;
    };
    const priorFetch = nativeGlobal.fetch; restoreNativeFetch = () => { nativeGlobal.fetch = priorFetch; };
    nativeGlobal.fetch = bridgedFetch; vi.stubGlobal('fetch', bridgedFetch);
  }, 60000);
  afterAll(async () => {
    vi.unstubAllGlobals(); restoreNativeFetch?.();
    for (const server of [targetServer, proxy]) if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    if (p) { await p.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); await p.$disconnect(); }
    (await import('@/server/queue/connection')).redis.disconnect(); vi.unstubAllEnvs();
  });
  async function consoleFixture() {
    const program = await p.bountyProgram.create({ data: { ownerId, companyName: 'Research traffic fixture', requiredUserAgent: 'DeletionTraffic/1',
      executionPolicies: { create: { version: 1, policy: { automationAllowed: true, requiredUserAgent: 'DeletionTraffic/1', requiredHeaders: [],
        exclusions: [], requestsPerSecond: 100, maxConcurrency: 1, forbiddenCategories: [], sourceSnapshot: { url: null, rules: '', unrepresentedRules: [] } } } } } });
    const scope = await p.scope.create({ data: { userId: ownerId, hostPattern: 'app.example.test', status: 'APPROVED' } });
    const asset = await p.scopeAsset.create({ data: { programId: program.id, originalValue: base + '/', normalizedValue: base + '/', format: 'URL', type: 'WEB_APPLICATION' } });
    const target = await p.target.create({ data: { scopeAssetId: asset.id, programId: program.id, userId: ownerId, scopeId: scope.id, host: new URL(base).hostname, scheme: 'http' } });
    const session = await p.researchSession.create({ data: { userId: ownerId, targetId: target.id, consoleTargetId: target.id, workspaceId: 'research_' + target.id,
      targetHost: target.host, programName: program.companyName, scopeMarkdown: 'Fixture', status: 'READY' } });
    // The still-open MCP/browser retains its original immutable policy/token.
    const policy = consolePolicySchema.parse({ version: 2, sessionId: session.id, targetId: target.id, workspaceId: session.workspaceId,
      targetHost: 'app.example.test', scheme: 'http', port: Number(new URL(base).port), assetScope: { normalizedValue: base + '/', format: 'URL', active: true },
      requiredUserAgent: program.requiredUserAgent, trafficCapability: researchTrafficCapability(target.id, session.id, ownerId),
      authorizationSource: 'Controlled SQL fixture', generatedAt: new Date().toISOString(), scopeSha256: 'a'.repeat(64), mode: 'SCOPED_ACTIVE_HTTP' });
    return { program, target, policy };
  }
  it.each(['BountyProgram', 'Target'])('immediately refuses HTTP/1, HTTP/2 and browser requests after deleting %s', async table => {
    const fixture = await consoleFixture(), cached = fixture.policy;
    const input = { targetHostname: cached.targetHost, targetPort: cached.port, usesHttps: false, content: 'GET / HTTP/1.1\r\nHost: app.example.test\r\n\r\n' };
    const start = hits;
    const allowed = await sendViaBurpProxy('send_http1_request', input, cached, { audit: () => {} });
    expect(allowed.remoteStatus).toBe(200); expect(hits).toBe(start + 1);
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    try {
      const context = await browser.newContext({ proxy: { server: 'http://127.0.0.1:' + (proxy.address() as { port: number }).port } }), page = await context.newPage();
      vi.stubEnv('BUGHUNTER_BROWSER_POLICY', JSON.stringify({ ...cached, host: cached.targetHost }));
      await browserScope({ page }); await page.goto(base + '/before');
      const before = hits, proxyBefore = proxyHits;
      expect(before).toBeGreaterThan(start + 1);
      if (table === 'BountyProgram') await p.$executeRaw`DELETE FROM "BountyProgram" WHERE id=${fixture.program.id}`;
      else await p.$executeRaw`DELETE FROM "Target" WHERE id=${fixture.target.id}`;
      authResults.length = 0;
      await expect(sendViaBurpProxy('send_http1_request', input, cached, { audit: () => {} })).rejects.toThrow('TOOL_NOT_ALLOWED');
      await expect(sendViaBurpProxy('send_http2_request', { targetHostname: cached.targetHost, targetPort: cached.port, usesHttps: false,
        pseudoHeaders: { ':method': 'GET', ':scheme': 'http', ':authority': cached.targetHost, ':path': '/' }, headers: {}, requestBody: '' }, cached, { audit: () => {} })).rejects.toThrow('TOOL_NOT_ALLOWED');
      await expect(page.goto(base + '/after')).rejects.toThrow();
      expect(authResults.filter(status => status === 403)).toHaveLength(3);
      expect(hits).toBe(before); expect(proxyHits).toBe(proxyBefore);
    } finally { await browser.close(); }
  });
  it('refuses a request already waiting for a Redis slot when deletion commits', async () => {
    const fixture = await consoleFixture();
    const { acquireProgramTraffic, releaseProgramTraffic } = await import('@/server/programTraffic');
    const occupied = await acquireProgramTraffic(fixture.program.id, { requestsPerSecond: 100, maxConcurrency: 1 }, AbortSignal.timeout(5000));
    let settled = false;
    const blocked = acquireResearchTraffic(fixture.policy, 'research-http', base + '/waiting').then(permit => { settled = true; return { permit, error: null }; }, error => { settled = true; return { permit: null, error }; });
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(settled).toBe(false);
    await p.$executeRaw`DELETE FROM "BountyProgram" WHERE id=${fixture.program.id}`;
    await releaseProgramTraffic(fixture.program.id, occupied);
    expect((await blocked).error?.message).toBe('TOOL_NOT_ALLOWED');
  });
});
