import { beforeScanNetwork, currentScanControl, recordUsefulScanWork, throwIfScanAborted } from "./scanControl";
import { logger } from "@/lib/logger";
import { AsyncLocalStorage } from "node:async_hooks";
import { chromium, type Browser, type Route } from "playwright-chromium";
import { prisma } from "@/lib/prisma";
import { isExcluded, programSchema, matchesHost } from "@/lib/bountyProgram";
import { assetAllowsUrl, assetAllowsHost, detectScopeAsset, type AssetBoundary } from '@/lib/scopeAssets';
import type { ReconPlan } from '@/lib/reconPlanner';

export interface TargetRequestGuard {
  assertRequest?(url: string, method: string, body?: string): void;
  acquire(url: string, method: string): (() => void) | Promise<() => void>;
  remainingMs(): number;
  signal: AbortSignal;
}
export interface TargetExecution {
  reconPlan?: ReconPlan;
  reconTempDir?: string;
  ffufWordlist?: string;
  reconRelayOrigin?: string;
  reconRelayTarget?: string;
  parentScopeAsset?: AssetBoundary & { id: string; programId: string; type: string; assetValue: string; originalValue: string };
  scopeAsset?: AssetBoundary & { id: string; programId: string; type: string; assetValue: string; originalValue: string };
  programReconId?: string;
  reconSeeds?: readonly string[];
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
export function scanRejection(target: { userId: string; host: string; active: boolean; contextOnly?: boolean; discoverySource?: string | null; scopeAsset?: (AssetBoundary & { programId?: string }) | null; scope: { status: string }; program: { id?: string; ownerId: string; requiredUserAgent: string; outOfScope: string[]; deletingAt?: Date | null; scopeRules?: string[] } | null }, purpose: 'HOST' | 'RECON' = 'HOST'): string | null {
  if (target.program?.deletingAt) return 'Target deletion is in progress';
  if (target.scope.status !== "APPROVED") return "Target's scope is not APPROVED; refusing to scan";
  if (!target.active && !target.contextOnly && !target.scopeAsset) return "Host has been removed from Scope";
  if (!target.program || target.program.ownerId !== target.userId) return "Add this host to a Target with a required User-Agent before scanning";
  if (!programSchema.shape.requiredUserAgent.safeParse(target.program.requiredUserAgent).success || target.program.requiredUserAgent !== target.program.requiredUserAgent.trim()) return "Target requires a valid User-Agent";
  if (target.scopeAsset) {
    if (!target.scopeAsset.active || !detectScopeAsset(target.scopeAsset.normalizedValue).executable) return 'Scope asset is archived or unsupported';
    if (target.scopeAsset.programId !== target.program.id) return 'Asset program mismatch';
    if (target.scopeAsset.format === 'WILDCARD_DOMAIN') return purpose === 'RECON' ? null : 'Wildcard is a discovery rule; Research stays passive until an authorized concrete host is selected';
    return isExcluded(target.host, target.program.outOfScope) ? 'Host is explicitly out of scope' : null;
  }
  if (target.contextOnly) return purpose !== 'RECON' ? 'Program context supports passive Recon only' : target.program.scopeRules?.length ? null : 'Configure authorized scope rules before Recon';
  if (target.discoverySource && !target.program.scopeRules?.some(rule => matchesHost(target.host, rule))) return "Discovered host is no longer within authorized program scope";
  if (target.host.includes('*')) return purpose === 'RECON' && target.program.scopeRules?.includes(target.host) ? null : 'Wildcard is a discovery rule; use program Recon for passive enumeration';
  if (isExcluded(target.host, target.program.outOfScope)) return "Host is explicitly out of scope";
  return null;
}
export async function loadTargetExecution(targetId: string, purpose: 'HOST' | 'RECON' = 'HOST'): Promise<TargetExecution> {
  const target = await prisma.target.findUnique({ where: { id: targetId }, include: { program: true, scope: true, scopeAsset: true, discoveredFromAsset: true } });
  if (!target) throw new Error("Host not found");
  const error = scanRejection(target, purpose);
  if (error) throw new Error(error);
  if (target.discoveredFromAsset && (!target.discoveredFromAsset.active || !assetAllowsHost(target.discoveredFromAsset, target.host))) throw new Error('Parent Scope Asset no longer authorizes this discovered host');
  return { targetId, host: target.scopeAsset?.format === 'URL' ? new URL(target.scopeAsset.normalizedValue).host : target.host, ...(target.scopeAsset ? { scopeAsset: target.scopeAsset } : {}), ...(target.discoveredFromAsset ? { parentScopeAsset: target.discoveredFromAsset } : {}), ...((target.contextOnly && !target.scopeAsset) || target.host.startsWith('*.') ? { programReconId: target.program!.id } : {}), requiredUserAgent: target.program!.requiredUserAgent,
    qualifying: target.program!.qualifying, nonQualifying: target.program!.nonQualifying };
}
/** Requests stay on the selected concrete identity. Discovery never grants access. */
export function assertExecutionUrl(url: string, ctx = currentTargetExecution()): void {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.host.toLowerCase() !== ctx.host.toLowerCase()) throw new Error("URL is outside the selected active Scope host");
  if (ctx.scopeAsset && !assetAllowsUrl(ctx.scopeAsset, url)) throw new Error('URL is outside the selected Scope Asset boundary');
  if (ctx.parentScopeAsset && !assetAllowsUrl(ctx.parentScopeAsset, url)) throw new Error('URL is outside the parent Scope Asset boundary');
}
export function executionHeaders(headers?: HeadersInit): Headers {
  const ctx = currentTargetExecution();
  const result = new Headers(headers);
  result.set("User-Agent", ctx.requiredUserAgent);
  return result;
}
/** Register launch itself before awaiting it, so cancellation also waits for a
 * browser that is still starting and closes it before confirming cleanup. */
export async function launchTargetBrowser(options: Parameters<typeof chromium.launch>[0]) {
  throwIfScanAborted();
  const pending = chromium.launch(options);
  const control = currentScanControl();
  let closing: Promise<void> | undefined;
  const stop = () => closing ??= pending.then(browser => browser.close(), () => {});
  const release = control?.track(stop);
  try {
    const browser = await pending;
    browser.on?.("disconnected", () => release?.());
    if (control?.signal.aborted) { await stop(); control.assertActive(); }
    return browser;
  } catch (error) { release?.(); throw error; }
}

/** All browser traffic, including redirects, scripts, forms and subresources. */
export async function newTargetBrowserContext(browser: Browser, syntheticPage?: { url: string; html: string }) {
  const ctx = currentTargetExecution();
  throwIfScanAborted();
  const control = currentScanControl();
  const signals = [ctx.requestGuard?.signal, control?.signal].filter((s): s is AbortSignal => Boolean(s));
  const signal = AbortSignal.any(signals);
  signal.throwIfAborted();
  const context = await browser.newContext({ userAgent: ctx.requiredUserAgent, serviceWorkers: "block" });
  let closing: Promise<void> | undefined;
  const stop = () => closing ??= (async () => {
    await context.close();
    await browser.close();
    logger.info({ ...control?.identity, reason: "BROWSER_ABORTED" }, "scan browser context closed");
  })();
  const untrack = control?.track(stop);
  const onAbort = () => { void stop().catch(() => {}); };
  signal.addEventListener("abort", onAbort, { once: true });
  // Release normal contexts too; an abort during creation is checked below.
  context.on?.("close", () => { signal.removeEventListener("abort", onAbort); if (!closing) untrack?.(); });
  if (signal.aborted) { await stop(); untrack?.(); signal.throwIfAborted(); }
  await context.route("**/*", async (route: Route) => {
    if (signal.aborted) { await route.abort("aborted").catch(() => {}); return; }
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
      signal.throwIfAborted();
      await beforeScanNetwork();
      signal.throwIfAborted();
      const response = await route.fetch({ headers: Object.fromEntries(headers), maxRedirects: 0, timeout: Math.min(5000, ctx.requestGuard?.remainingMs() ?? 5000) });
      await recordUsefulScanWork();
      const responseHeaders = { ...response.headers() };
      if (response.status() >= 300 && response.status() < 400 && responseHeaders.location) {
        responseHeaders["x-bughunter-redirect-location"] = responseHeaders.location;
        delete responseHeaders.location;
      }
      await route.fulfill({ response, headers: responseHeaders });
    } catch { await route.abort("failed").catch(() => {}); } finally { release?.(); }
  });
  // Browser WebSocket traffic has no HTTP scan capability in BugHunter.
  await context.routeWebSocket("**/*", socket => socket.close());
  return context;
}
