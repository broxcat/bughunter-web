import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib';
import { allowFixture } from '../helpers/egressLab';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
import { launchTargetBrowser, newTargetBrowserContext, withTargetExecution } from '@/server/execution';

// Real Chromium: every request must leave through the pinned egress guard.
const suite = process.env.SCANNER_HTTP_TESTS === '1' ? describe : describe.skip;
suite('browser egress (C1)', () => {
  let allowed: Server, other: Server, base = '', otherBase = '';
  const allowedSeen: string[] = [], otherSeen: string[] = [];
  beforeAll(async () => {
    other = createServer((req, res) => { otherSeen.push(req.url ?? ''); res.end('other'); });
    other.listen(0, '127.0.0.1'); await once(other, 'listening');
    otherBase = `http://127.0.0.1:${(other.address() as { port: number }).port}`;
    allowed = createServer((req, res) => {
      allowedSeen.push(req.url ?? '');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (req.url?.startsWith('/compressed/')) {
        const encoding = req.url.split('/').at(-1) as 'gzip' | 'deflate' | 'br';
        const body = ({ gzip: gzipSync, deflate: deflateSync, br: brotliCompressSync })[encoding](Buffer.from('<title>decoded</title><p>body ✓</p>'));
        res.writeHead(200, { 'Content-Encoding': encoding, 'Content-Length': body.length, 'Set-Cookie': ['first=one; Path=/', 'second=two; Path=/'] }).end(body); return;
      }
      if (req.url === '/redirect') { res.writeHead(302, { Location: `${otherBase}/redirected` }); res.end(); return; }
      res.end(`<!doctype html><title>guarded</title>
        <img src="${otherBase}/img"><img src="http://169.254.169.254/latest/meta-data/">
        <iframe name="attack" src="${otherBase}/frame"></iframe>
        <form id="f" target="attack" action="${otherBase}/form" method="post"><input name="a" value="b"></form>
        <script>
          fetch('${otherBase}/fetch').catch(()=>{});
          fetch('http://metadata.google.internal/').catch(()=>{});
          try { new WebSocket('${otherBase.replace('http', 'ws')}/ws'); } catch {}
          try { new Worker(URL.createObjectURL(new Blob(["fetch('${otherBase}/worker')"]))); } catch {}
          navigator.sendBeacon && navigator.sendBeacon('${otherBase}/beacon', 'x');
          setTimeout(()=>document.getElementById('f').submit(), 50);
        </script>`);
    });
    allowed.listen(0, '127.0.0.1'); await once(allowed, 'listening');
    base = `http://127.0.0.1:${(allowed.address() as { port: number }).port}`;
    allowFixture(allowed); // Only the target fixture is an exact lab exception.
  });
  afterAll(async () => { await new Promise<void>(r => allowed.close(() => r())); await new Promise<void>(r => other.close(() => r())); });

  it('loads the in-scope page through the guard and lets nothing else reach the network', async () => {
    const ctx = { targetId: 't', host: new URL(base).host, requiredUserAgent: 'UA/1', qualifying: [], nonQualifying: [] };
    await withTargetExecution(ctx, async () => {
      const browser = await launchTargetBrowser({ headless: true });
      try {
        const context = await newTargetBrowserContext(browser);
        const page = await context.newPage();
        await page.goto(base + '/');
        expect(await page.title()).toBe('guarded');
        await page.waitForTimeout(1500);
        const redirect = await page.goto(base + '/redirect').catch(() => null);
        expect(redirect?.status()).toBe(302);
        await page.waitForTimeout(300);
      } finally { await browser.close(); }
    });
    expect(allowedSeen).toContain('/');
    expect(otherSeen).toEqual([]);
  }, 30000);

  it.each(['gzip', 'deflate', 'br'])('fulfills decoded %s into real Chromium without losing cookies', async encoding => {
    await withTargetExecution({ targetId: 't', host: new URL(base).host, requiredUserAgent: 'UA/1', qualifying: [], nonQualifying: [] }, async () => {
      const browser = await launchTargetBrowser({ headless: true });
      try {
        const context = await newTargetBrowserContext(browser), page = await context.newPage();
        await page.goto(`${base}/compressed/${encoding}`);
        expect(await page.title()).toBe('decoded');
        expect(await page.locator('p').innerText()).toBe('body ✓');
        expect((await context.cookies()).map(c => `${c.name}=${c.value}`).sort()).toEqual(['first=one', 'second=two']);
      } finally { await browser.close(); }
    });
  }, 30000);

  it('serves a non-DNS lab host only through the pinned guard, never through Chromium resolution', async () => {
    const port = (allowed.address() as { port: number }).port;
    const previous = process.env.EGRESS_LAB_ALLOWLIST;
    process.env.EGRESS_LAB_ALLOWLIST = `${previous},scope.lab.test:${port}=127.0.0.1`;
    try {
      const ctx = { targetId: 't', host: `scope.lab.test:${port}`, requiredUserAgent: 'UA/1', qualifying: [], nonQualifying: [] };
      await withTargetExecution(ctx, async () => {
        const browser = await launchTargetBrowser({ headless: true });
        try {
          const page = await (await newTargetBrowserContext(browser)).newPage();
          await page.goto(`http://scope.lab.test:${port}/`);
          expect(await page.title()).toBe('guarded');
          // Same host, different port: not an exact lab entry, so refused.
          await expect(page.goto(`http://scope.lab.test:${port + 1}/`)).rejects.toThrow();
        } finally { await browser.close(); }
      });
    } finally { process.env.EGRESS_LAB_ALLOWLIST = previous; }
  }, 30000);

  it('a request escaping interception cannot resolve or connect (closed proxy, NOTFOUND resolver)', async () => {
    const before = otherSeen.length;
    await withTargetExecution({ targetId: 't', host: new URL(base).host, requiredUserAgent: 'UA/1', qualifying: [], nonQualifying: [] }, async () => {
      const browser = await launchTargetBrowser({ headless: true });
      try {
        const page = await (await browser.newContext()).newPage(); // deliberately no route()
        await expect(page.goto(otherBase + '/escaped', { timeout: 5000 })).rejects.toThrow();
        await expect(page.goto('http://example.com/', { timeout: 5000 })).rejects.toThrow();
      } finally { await browser.close(); }
    });
    expect(otherSeen.length).toBe(before);
  }, 30000);
});
