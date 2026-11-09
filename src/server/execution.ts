import { beforeScanNetwork, currentScanControl, recordUsefulScanWork, throwIfScanAborted } from "./scanControl";
import { logger } from "@/lib/logger";
import { AsyncLocalStorage } from "node:async_hooks";
import { chromium, type Browser, type Route } from "playwright-chromium";
import { prisma } from "@/lib/prisma";
import { isExcluded, matchesHost } from "@/lib/bountyProgram";
import { assetAllowsHost, scopeAssetExecutable, type AssetBoundary } from '@/lib/scopeAssets';
import type { ReconPlan } from '@/lib/reconPlanner';
import { isSafeReadUrl } from '@/lib/observationSafety';
import { authorizeExecution, programPolicyInclude, resolveProgramPolicy, type PolicyProgram, type ResolvedProgramPolicy } from './programExecutionPolicy';
import { acquireProgramTraffic, releaseProgramTraffic } from './programTraffic';

export interface TargetRequestGuard {
  assertRequest?(url: string, method: string, body?: string): void;
  acquire(url: string, method: string): (() => void) | Promise<() => void>;
  remainingMs(): number;
  signal: AbortSignal;
}
export interface TargetExecution {
  /** Server-only, request-local loader. Never serialized or passed to scanners. */
  authenticatedOrigin?: string;
  authenticatedRequestHeaders?: (url: string, method: string) => Promise<Record<string, string>>;
  reconPlan?: ReconPlan;
  contentBaseline?: import('./recon/calibration').UnknownPathBaseline;
  reconTempDir?: string;
  ffufWordlist?: string;
  gobusterWordlist?: string;
  gobusterResolver?:string;
  reconRelayOrigin?: string;
  reconRelayTarget?: string;
  parentScopeAsset?: AssetBoundary & { id: string; programId: string; type: string; assetValue: string; originalValue: string };
  scopeAsset?: AssetBoundary & { id: string; programId: string; type: string; assetValue: string; originalValue: string };
  programReconId?: string;
  reconSeeds?: readonly string[];
  requestGuard?: TargetRequestGuard;
  targetId: string;
  programId?: string;
  policy?: ResolvedProgramPolicy;
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
function scanScopeRejection(target: { userId: string; host: string; active: boolean; contextOnly?: boolean; discoverySource?: string | null; scopeAsset?: (AssetBoundary & { programId?: string }) | null; scope: { status: string; userId?: string; hostPattern?: string; scopeDetails?: string | null; outOfScope?: string | null; rulesOfEngagement?: string | null }; program: (PolicyProgram & { id?: string; ownerId: string; deletingAt?: Date | null; scopeRules?: string[] }) | null }, purpose: 'HOST' | 'RECON'): string | null {
  if (target.program?.deletingAt) return 'Target deletion is in progress';
  if (target.scope.status !== "APPROVED") return "Target's scope is not APPROVED; refusing to scan";
  if (target.scope.userId && target.scope.userId !== target.userId) return 'Scope owner mismatch';
  if (!target.active && !target.contextOnly && !target.scopeAsset) return "Host has been removed from Scope";
  if (!target.program || target.program.ownerId !== target.userId) return "Add this host to a Target with a required User-Agent before scanning";
  if (target.scopeAsset) {
    if (!target.scopeAsset.active || !scopeAssetExecutable(target.scopeAsset)) return 'Scope asset is archived or unsupported';
    if (target.scopeAsset.programId !== target.program.id) return 'Asset program mismatch';
    if (target.scopeAsset.format === 'WILDCARD_DOMAIN') return purpose === 'RECON' ? null : 'Wildcard is a discovery rule; Research stays passive until an authorized concrete host is selected';
    return isExcluded(target.host, target.program.outOfScope) ? 'Host is explicitly out of scope' : null;
  }
  if (target.contextOnly) return purpose !== 'RECON' ? 'Program context supports passive Recon only' : target.program.scopeRules?.length ? null : 'Configure authorized scope rules before Recon';
  if (target.discoverySource && !target.program.scopeRules?.some(rule => matchesHost(target.host, rule))) return "Discovered host is no longer within authorized program scope";
  if (target.host.includes('*')) return purpose === 'RECON' && target.program.scopeRules?.includes(target.host) ? null : 'Wildcard is a discovery rule; use program Recon for passive enumeration';
  if (target.scope.hostPattern && !matchesHost(target.host, target.scope.hostPattern)) return 'Host is outside the approved Scope';
  if (isExcluded(target.host, target.program.outOfScope)) return "Host is explicitly out of scope";
  return null;
}
export function scanRejection(target: Parameters<typeof scanScopeRejection>[0], purpose: 'HOST' | 'RECON' = 'HOST', requirePolicy = true) {
  const rejection = scanScopeRejection(target, purpose);
  if (rejection || !requirePolicy) return rejection;
  try { return resolveProgramPolicy(target.program!, target.scope).blocker; }
  catch { return 'Invalid program execution policy'; }
}

export async function loadTargetExecution(targetId: string, purpose: 'HOST' | 'RECON' = 'HOST', captured?: ReconPlan): Promise<TargetExecution> {
  const target = await prisma.target.findUnique({ where: { id: targetId }, include: { program: { include: programPolicyInclude }, scope: true, scopeAsset: true, discoveredFromAsset: true } });
  if (!target) throw new Error("Host not found");
  if (captured && target.scopeAsset && !target.scopeAsset.active) throw new Error('Scope Asset archived');
  if (captured && target.scopeAsset && (target.scopeAsset.normalizedValue !== captured.boundary.normalizedValue || target.scopeAsset.format !== captured.boundary.format)) throw new Error('Scope Asset authorization changed');
  if(captured && target.scopeAsset?.id===captured.scopeAssetId) {
    target.scopeAsset={...target.scopeAsset,...captured.boundary,format:captured.format as NonNullable<typeof target.scopeAsset>['format'],type:captured.type as NonNullable<typeof target.scopeAsset>['type'],assetValue:captured.assetValue};
    target.host=captured.format==='URL'?new URL(captured.boundary.normalizedValue).hostname:captured.boundary.normalizedValue;
  }
  const error = scanRejection(target, purpose);
  if (error) throw new Error(error);
  if (target.discoveredFromAsset && (!target.discoveredFromAsset.active || !assetAllowsHost(target.discoveredFromAsset, target.host))) throw new Error('Parent Scope Asset no longer authorizes this discovered host');
  const policy = resolveProgramPolicy(target.program!, target.scope);
  return { programId: target.program!.id, policy, ...(captured?{reconPlan:captured}:{}), targetId, host: target.scopeAsset?.format === 'URL' ? new URL(target.scopeAsset.normalizedValue).host : target.host, ...(target.scopeAsset ? { scopeAsset: target.scopeAsset } : {}), ...(target.discoveredFromAsset ? { parentScopeAsset: target.discoveredFromAsset } : {}), ...((target.contextOnly && !target.scopeAsset) || target.host.startsWith('*.') ? { programReconId: target.program!.id } : {}), requiredUserAgent: policy.userAgent,
    qualifying: target.program!.qualifying, nonQualifying: target.program!.nonQualifying };
}
/** Requests stay on the selected concrete identity. Discovery never grants access. */
export function assertExecutionUrl(url: string, ctx = currentTargetExecution()): void {
  authorizeExecution(ctx, { url });
}
export async function assertLiveExecution(ctx = currentTargetExecution()) {
  if (!ctx.programId) return;
  const latest = await loadTargetExecution(ctx.targetId, ctx.reconPlan || ctx.programReconId ? 'RECON' : 'HOST', ctx.reconPlan);
  const boundaryKey = (asset: TargetExecution['scopeAsset']) => asset && [asset.id, asset.normalizedValue, asset.format, asset.active].join('\n');
  if (latest.programId !== ctx.programId || latest.policy?.fingerprint !== ctx.policy?.fingerprint ||
      boundaryKey(latest.scopeAsset) !== boundaryKey(ctx.scopeAsset) ||
      boundaryKey(latest.parentScopeAsset) !== boundaryKey(ctx.parentScopeAsset) ||
      (latest.scopeAsset?.format !== 'WILDCARD_DOMAIN' && latest.host !== ctx.host)) {
    throw new Error('Program or Scope changed during execution');
  }
}

export async function acquireExecution(
  activity: { tool: string; url?: string; dnsHost?: string },
  signal: AbortSignal,
  ctx = currentTargetExecution(),
) {
  authorizeExecution(ctx, activity);
  if (!ctx.programId) return async () => {};
  if (!ctx.policy) throw new Error('Missing program execution policy');
  const programId = ctx.programId;
  const lease = await acquireProgramTraffic(programId, ctx.policy.limits, signal);
  const release = () => releaseProgramTraffic(programId, lease).catch(() => {});
  try {
    await assertLiveExecution(ctx);
    signal.throwIfAborted();
    return release;
  } catch (error) {
    await release();
    throw error;
  }
}

export function executionHeaders(headers?: HeadersInit): Headers {
  const ctx = currentTargetExecution();
  const result = new Headers(headers);
  for (const [name, value] of Object.entries(ctx.policy?.headers ?? {})) result.set(name, value);
  result.set("User-Agent", ctx.requiredUserAgent);
  return result;
}
/** Scope and read-only checks precede decrypting any context credential. */
export async function authenticatedExecutionHeaders(url: string, method: string, supplied?: HeadersInit, body?: string) {
  const ctx = currentTargetExecution();
  const headers = executionHeaders(supplied);
  if (!ctx.authenticatedRequestHeaders) return headers;
  assertExecutionUrl(url, ctx);
  if (!ctx.authenticatedOrigin || new URL(url).origin !== ctx.authenticatedOrigin || !['GET', 'HEAD'].includes(method) || body !== undefined || !isSafeReadUrl(url)) throw new Error('AUTH_CONTEXT_SCOPE_BLOCKED');
  if (['cookie', 'authorization', 'proxy-authorization', 'host'].some(key => headers.has(key))) throw new Error('AUTH_CONTEXT_HEADER_OVERRIDE');
  const privateHeaders = new Headers(await ctx.authenticatedRequestHeaders(url, method));
  for (const [key, value] of privateHeaders) {
    if (!['cookie', 'authorization'].includes(key)) throw new Error('AUTH_CONTEXT_HEADER_OVERRIDE');
    headers.set(key, value);
  }
  headers.set('User-Agent', ctx.requiredUserAgent);
  return headers;
}
/** Register launch itself before awaiting it, so cancellation also waits for a
 * browser that is still starting and closes it before confirming cleanup. */
export async function launchTargetBrowser(options: Parameters<typeof chromium.launch>[0]) {
  throwIfScanAborted();
  authorizeExecution(currentTargetExecution(), { tool: 'browser' });
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
  authorizeExecution(ctx, { tool: 'browser' });
  const context = await browser.newContext({ userAgent: ctx.requiredUserAgent, serviceWorkers: "block" });
  let closing: Promise<void> | undefined;
  const stop = () => closing ??= (async () => {
    await context.close();
    await browser.close();
    // Release only after both resources confirmed closure. An aborted local
    // mapping guard must not leave a fulfilled stop registered for later
    // cleanup against an already closed browser connection.
    untrack?.();
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
    if (ctx.authenticatedRequestHeaders) {
      // A fresh context may receive Set-Cookie. The next request still uses only
      // the live verified credential, never browser-controlled auth material.
      for (const name of ['cookie', 'authorization', 'proxy-authorization', 'host']) headers.delete(name);
    }
    headers.set("User-Agent", ctx.requiredUserAgent);
    // Chromium does not route every hop of a native redirect chain. Observe
    // redirects without following them, as the internal HTTP probe does.
    let release: (() => void) | undefined;
    let releaseTraffic: (() => Promise<void>) | undefined;
    try {
      ctx.requestGuard?.assertRequest?.(url, route.request().method(), route.request().postData() ?? undefined);
      release = await ctx.requestGuard?.acquire(url, route.request().method());
      signal.throwIfAborted();
      await beforeScanNetwork();
      signal.throwIfAborted();
      const authorizedHeaders = await authenticatedExecutionHeaders(url, route.request().method(), headers, route.request().postData() ?? undefined);
      signal.throwIfAborted();
      releaseTraffic = await acquireExecution({ tool: 'browser', url }, AbortSignal.any([signal, AbortSignal.timeout(5000)]), ctx);
      const response = await route.fetch({ headers: Object.fromEntries(authorizedHeaders), maxRedirects: 0, timeout: Math.min(5000, ctx.requestGuard?.remainingMs() ?? 5000) });
      await recordUsefulScanWork();
      const responseHeaders = { ...response.headers() };
      if (response.status() >= 300 && response.status() < 400 && responseHeaders.location) {
        responseHeaders["x-bughunter-redirect-location"] = responseHeaders.location;
        delete responseHeaders.location;
      }
      try { await route.fulfill({ response, headers: responseHeaders }); } finally { await response.dispose(); }
    } catch { await route.abort("failed").catch(() => {}); } finally { await releaseTraffic?.(); release?.(); }
  });
  // Browser WebSocket traffic has no HTTP scan capability in BugHunter.
  await context.routeWebSocket("**/*", socket => socket.close());
  return context;
}
