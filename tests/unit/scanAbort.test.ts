import { allowFixture } from '../helpers/egressLab';
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { type Browser } from "playwright-chromium";
import * as isolated from '@/server/isolatedBrowser';
import { ScanControl, withScanControl } from "@/server/scanControl";
import { withTargetExecution, launchTargetBrowser, newTargetBrowserContext } from "@/server/execution";
import { probe } from "@/server/scanners/http";
const identity = { scanRunId: "run", attemptId: "attempt", workerId: "worker" };
let server: Server, base: string, arrived: () => void, disconnected: () => void;
beforeAll(async () => {
  server = createServer((_req, res) => { res.writeHead(200); res.write("partial body"); arrived(); res.on("close", () => disconnected()); });
  server.listen(0, "127.0.0.1"); await once(server, "listening"); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  allowFixture(server);
});
afterAll(() => { server.closeAllConnections(); return new Promise<void>(resolve => server.close(() => resolve())); });
const target = () => ({ targetId: "target", host: new URL(base).host, requiredUserAgent: "AbortTest/1", qualifying: [], nonQualifying: [] });
describe("scan AbortSignal propagation", () => {
  it("aborts the real response body, drains the resource and prevents subsequent traffic", async () => {
    const control = new ScanControl(identity, async () => {});
    const received = new Promise<void>(resolve => { arrived = resolve; }); const closed = new Promise<void>(resolve => { disconnected = resolve; });
    const work = withScanControl(control, () => withTargetExecution(target(), () => probe(base, { timeoutMs: 60000 })));
    const rejected = expect(work).rejects.toMatchObject({ reason: "USER_CANCELLED" });
    await received; control.abort("USER_CANCELLED"); await rejected; await closed;
    expect(await control.cleanup()).toBe(true);
    await expect(withScanControl(control, () => withTargetExecution(target(), () => probe(base)))).rejects.toMatchObject({ reason: "USER_CANCELLED" });
  });
  it("an explicit probe signal also cancels an in-flight fetch", async () => {
    const controller = new AbortController(); const received = new Promise<void>(resolve => { arrived = resolve; }); disconnected = () => {};
    const work = withTargetExecution(target(), () => probe(base, { signal: controller.signal, timeoutMs: 60000 }));
    const rejected = expect(work).rejects.toThrow(); await received; controller.abort(); await rejected;
  });

  it("closes Playwright context and browser on abort and awaits their cleanup", async () => {
    const control = new ScanControl(identity, async () => {});
    const context = { route: vi.fn(async () => {}), routeWebSocket: vi.fn(async () => {}), close: vi.fn(async () => {}), on: vi.fn() };
    const browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => {}) };
    await withScanControl(control, () => withTargetExecution(target(), () => newTargetBrowserContext(browser as unknown as Browser)));
    control.abort("USER_CANCELLED"); expect(await control.cleanup()).toBe(true);
    expect(context.close).toHaveBeenCalledOnce(); expect(browser.close).toHaveBeenCalledOnce();
  });
  it("waits for an in-flight browser launch and closes it before confirming cleanup", async () => {
    const control = new ScanControl(identity, async () => {});
    const browser = { close: vi.fn(async () => {}), on: vi.fn() };
    let launched!: (value: Browser) => void;
    const spy = vi.spyOn(isolated, 'launchIsolatedBrowser').mockReturnValue(new Promise(resolve => { launched = resolve; }));
    try {
      const startup = withScanControl(control, () => withTargetExecution(target(), () => launchTargetBrowser({ headless: true })));
      const rejected = expect(startup).rejects.toMatchObject({ reason: "USER_CANCELLED" });
      control.abort("USER_CANCELLED"); let confirmed = false;
      const cleanup = control.cleanup().then(result => { confirmed = result; });
      await Promise.resolve(); expect(confirmed).toBe(false);
      launched(browser as unknown as Browser); await rejected; await cleanup;
      expect(confirmed).toBe(true); expect(browser.close).toHaveBeenCalledOnce();
    } finally { spy.mockRestore(); }
  });

});
