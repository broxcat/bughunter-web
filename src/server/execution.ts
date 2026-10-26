import { AsyncLocalStorage } from "node:async_hooks";
import type { Browser, Route } from "playwright-chromium";
import { prisma } from "@/lib/prisma";
import { isExcluded, programSchema } from "@/lib/bountyProgram";

export interface TargetRequestGuard {
  assertRequest?(url: string, method: string, body?: string): void;
  acquire(url: string, method: string): (() => void) | Promise<() => void>;
  remainingMs(): number;
  signal: AbortSignal;
}
export interface TargetExecution {
  requestGuard?: TargetRequestGuard;
  targetId: string;
  host: string;
  requiredUserAgent: string;
  qualifying: readonly string[];
  nonQualifying: readonly string[];
}
const storage = new AsyncLocalStorage<TargetExecution>();
export function withTargetExecution<T>(context: TargetExecution, work: () => T): T {
  return storage.run(Object.freeze({ ...context }), work);
}
export function currentTargetExecution(): TargetExecution {
  const ctx = storage.getStore();
  if (!ctx) throw new Error("Missing authorized Target execution context");
  return ctx;
}
export function scanRejection(target: { userId: string; host: string; active: boolean; scope: { status: string }; program: { ownerId: string; requiredUserAgent: string; outOfScope: string[] } | null }): string | null {
  if (target.scope.status !== "APPROVED") return "Target's scope is not APPROVED; refusing to scan";
  if (!target.active) return "Host has been removed from Scope";
  if (!target.program || target.program.ownerId !== target.userId) return "Add this host to a Target with a required User-Agent before scanning";
  if (!programSchema.shape.requiredUserAgent.safeParse(target.program.requiredUserAgent).success || target.program.requiredUserAgent !== target.program.requiredUserAgent.trim()) return "Target requires a valid User-Agent";
  if (target.host.includes("*")) return "Add a concrete FQDN to Scope before scanning a wildcard rule";
  if (isExcluded(target.host, target.program.outOfScope)) return "Host is explicitly out of scope";
  return null;
}
export async function loadTargetExecution(targetId: string): Promise<TargetExecution> {
  const target = await prisma.target.findUnique({ where: { id: targetId }, include: { program: true, scope: true } });
  if (!target) throw new Error("Host not found");
  const error = scanRejection(target);
  if (error) throw new Error(error);
  return { targetId, host: target.host, requiredUserAgent: target.program!.requiredUserAgent,
    qualifying: target.program!.qualifying, nonQualifying: target.program!.nonQualifying };
}
/** Requests stay on the selected concrete identity. Discovery never grants access. */
export function assertExecutionUrl(url: string, ctx = currentTargetExecution()): void {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.host.toLowerCase() !== ctx.host.toLowerCase()) throw new Error("URL is outside the selected active Scope host");
}
export function executionHeaders(headers?: HeadersInit): Headers {
  const ctx = currentTargetExecution();
  const result = new Headers(headers);
  result.set("User-Agent", ctx.requiredUserAgent);
  return result;
}
/** All browser traffic, including redirects, scripts, forms and subresources. */
export async function newTargetBrowserContext(browser: Browser, syntheticPage?: { url: string; html: string }) {
  const ctx = currentTargetExecution();
  const context = await browser.newContext({ userAgent: ctx.requiredUserAgent, serviceWorkers: "block" });
  await context.route("**/*", async (route: Route) => {
    const url = route.request().url();
    if (syntheticPage && url === syntheticPage.url) {
      await route.fulfill({ contentType: "text/html", body: syntheticPage.html }); return;
    }
    try { assertExecutionUrl(url, ctx); } catch { await route.abort("blockedbyclient"); return; }
    const headers = new Headers(route.request().headers());
    headers.set("User-Agent", ctx.requiredUserAgent);
    // Chromium does not route every hop of a native redirect chain. Observe
    // redirects without following them, as the internal HTTP probe does.
    let release: (() => void) | undefined;
    try {
      ctx.requestGuard?.assertRequest?.(url, route.request().method(), route.request().postData() ?? undefined);
      release = await ctx.requestGuard?.acquire(url, route.request().method());
      const response = await route.fetch({ headers: Object.fromEntries(headers), maxRedirects: 0, timeout: Math.min(5000, ctx.requestGuard?.remainingMs() ?? 5000) });
      const responseHeaders = { ...response.headers() };
      if (response.status() >= 300 && response.status() < 400 && responseHeaders.location) {
        responseHeaders["x-bughunter-redirect-location"] = responseHeaders.location;
        delete responseHeaders.location;
      }
      await route.fulfill({ response, headers: responseHeaders });
    } catch { await route.abort("failed").catch(() => {}); } finally { release?.(); }
  });
  ctx.requestGuard?.signal.addEventListener("abort", () => { void context.close().catch(() => {}); }, { once: true });
  // Browser WebSocket traffic has no HTTP scan capability in BugHunter.
  await context.routeWebSocket("**/*", socket => socket.close());
  return context;
}
