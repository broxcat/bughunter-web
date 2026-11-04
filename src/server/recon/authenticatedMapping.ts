import { credentialHeaders } from '@/server/credentials';
import { loadReconCredential, recordSurfaceObservation, surfaceResponseClass } from '@/server/authenticatedRecon';
import { assertExecutionUrl, currentTargetExecution, withTargetExecution, launchTargetBrowser, newTargetBrowserContext, type TargetRequestGuard } from '@/server/execution';
import { probe, type ProbeResult } from '@/server/scanners/http';
import { throwIfScanAborted } from '@/server/scanControl';
import { isSafeReadUrl } from '@/lib/observationSafety';
import { RECON_AUTH_MAPPING_BUDGETS, type ReconPlan } from '@/lib/reconPlanner';
import type { AuthContextsSnapshot, CapturedAuthContext, AuthContextCoverage } from '@/lib/authenticatedRecon';
import { safeSurfaceUrl } from '@/lib/authenticatedRecon';
import type { ArtifactKind } from '@/lib/reconArtifacts';
import { analyzeCorpus } from './corpus';
import { ReconProtection } from './protection';
import { classifyReconFailure } from '@/lib/reconCapabilities';

export type AuthenticatedMappingResult = { version: 1; contexts: AuthContextCoverage[]; requests: number; browserRequests: number; warnings: string[]; complete: boolean };
export type AuthenticatedMappingOptions = {
  scanRunId: string; scopeAssetId: string; snapshot: AuthContextsSnapshot; plan: ReconPlan;
  signal: AbortSignal; seeds: string[]; anonymousPages?: Map<string, ProbeResult>;
  budget: { remaining: number }; assertLive?: () => Promise<unknown>;
  browser?: boolean;
  onArtifact?: (kind:ArtifactKind,value:Record<string,unknown>,sourceRef:string,contextKey:string)=>Promise<unknown>;
};
type Context = 'ANONYMOUS' | CapturedAuthContext;
type MappingGuard = TargetRequestGuard & { close: () => void };
const keyOf = (context: Context) => typeof context === 'string' ? context : context.contextKey;
const links = (html: string, base: string) => [...html.matchAll(/(?:href|src)\s*=\s*["']([^"'<>]{1,2048})/gi)].flatMap(match => {
  // Form actions and JS calls may declare writes. Record their metadata below;
  // never turn them into inferred GET requests.
  try { return [new URL(match[1], base).toString()]; } catch { return []; }
});
const surfacePriority=(url:string)=>{const path=new URL(url).pathname;return /\/(?:api|v\d+|graphql|dashboard|admin|profile|account)(?:\/|$)/i.test(path)?0:/\/(?:login|signin|sign-in)(?:\/|$)/i.test(path)?5:/\.(?:js|css|png|jpe?g|svg|woff2?)(?:$|\?)/i.test(path)?9:2;};
const fixedReason = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /AUTH_CONTEXT_SESSION_UNAVAILABLE/.test(message) ? 'AUTH_CONTEXT_SESSION_UNAVAILABLE' :
    /AUTH_CONTEXT_SESSION_LOST/.test(message) ? 'AUTH_CONTEXT_SESSION_LOST' :
    /scope|AUTH_CONTEXT_HEADER_OVERRIDE/i.test(message) ? 'AUTH_CONTEXT_SCOPE_BLOCKED' :
    /RATE_LIMITED/.test(message) ? 'AUTH_CONTEXT_RATE_LIMITED' :
    /budget|limit/i.test(message) ? 'AUTH_CONTEXT_RESOURCE_LIMIT' :
    /timeout|timed.out|aborted/i.test(message) ? 'AUTH_CONTEXT_TIMEOUT' : /network|fetch.failed|ECONN|ENETUNREACH/i.test(message) ? 'AUTH_CONTEXT_NETWORK_UNREACHABLE' : 'AUTH_CONTEXT_TRANSPORT_ERROR';
};

/** A separate bounded read-only map, sharing the existing asset request budget.
 * Raw URLs and response bodies live only in this invocation. No credentials are
 * supplied to child processes, files, logs, browser globals or other contexts. */
export async function mapAuthenticatedSurfaces(options: AuthenticatedMappingOptions): Promise<AuthenticatedMappingResult> {
  const execution = currentTargetExecution();
  const limits = options.plan.authenticatedMapping ?? { ...RECON_AUTH_MAPPING_BUDGETS[options.plan.assetValue], maxContexts: 4, browserRequestsPerContext: 4, browserPages: 1 };
  const deadline = AbortSignal.timeout(limits.maxDurationMs), signal = AbortSignal.any([options.signal, deadline]);
  const result: AuthenticatedMappingResult = { version: 1, contexts: [], requests: 0, browserRequests: 0, warnings: ['AUTH_MAPPING_READ_ONLY_GET_HEAD', 'AUTH_MAPPING_NO_FORM_SUBMISSION_OR_WEBSOCKETS'], complete: true };
  const sharedUrls = new Set<string>();
  const observed = new Map<string, Set<string>>();
  const nativePages = new Map<string, number>();
  const htmlStarts = new Map<string, string>();
  const contexts: Context[] = ['ANONYMOUS', ...options.snapshot.contexts.filter(context => context.eligibility === 'PLANNED').slice(0, Math.min(4, limits.maxContexts))];
  for (const context of options.snapshot.contexts.filter(context => context.eligibility !== 'PLANNED')) result.contexts.push({ contextKey: context.contextKey, state: context.eligibility === 'SESSION_UNAVAILABLE' ? 'SKIPPED_SESSION_UNAVAILABLE' : context.eligibility, requests: 0, pages: 0 });
  const protection = new ReconProtection(options.plan.limits.rps, limits.maxRequests);
  let tail = Promise.resolve();

  const allowed = (url: string, origin?: string) => {
    try { assertExecutionUrl(url, execution); return isSafeReadUrl(url) && (!origin || new URL(url).origin === origin) && !/\/__bughunter_/.test(new URL(url).pathname); } catch { return false; }
  };
  for (const seed of options.seeds) if (allowed(seed)) sharedUrls.add(seed);
  const requestCounts = new Map<string, number>();
  const contextState = new Map<string, AuthContextCoverage>();
  const stopped = new Set<string>();
  const origins = new Map<string, string>();
  const validations = new Map<string, string>();

  async function inContext<T>(context: Context, work: (guard: MappingGuard) => Promise<T>, browser = false): Promise<T> {
    const key = keyOf(context), origin = origins.get(key)!;
    const local = new AbortController(), contextSignal = AbortSignal.any([signal, local.signal]);
    let browserRequests = 0;
    const guard: MappingGuard = {
      close: () => local.abort(new Error('AUTH_CONTEXT_MAPPING_CLOSED')),
      signal: contextSignal, remainingMs: () => Math.max(1, Math.min(5000, limits.maxDurationMs)),
      assertRequest(url, method, body) { if (!allowed(url, origin) || !['GET', 'HEAD'].includes(method) || body !== undefined) throw new Error('AUTH_CONTEXT_SCOPE_BLOCKED'); },
      async acquire(url, method) {
        guard.assertRequest!(url, method);
        contextSignal.throwIfAborted();
        if (options.budget.remaining <= 0 || result.requests >= limits.maxRequests || browser && browserRequests >= limits.browserRequestsPerContext) throw new Error('AUTH_CONTEXT_RESOURCE_LIMIT');
        let release!: () => void;
        const previous = tail; tail = new Promise<void>(resolve => { release = resolve; });
        try {
          await new Promise<void>((resolve, reject) => {
            const abort = () => reject(contextSignal.reason);
            contextSignal.addEventListener('abort', abort, { once: true });
            void previous.then(() => { contextSignal.removeEventListener('abort', abort); resolve(); });
            if (contextSignal.aborted) abort();
          });
          contextSignal.throwIfAborted(); await options.assertLive?.();
          if (options.budget.remaining <= 0 || result.requests >= limits.maxRequests) throw new Error('AUTH_CONTEXT_RESOURCE_LIMIT');
          if (protection.blocked) throw new Error(protection.reasonCode === 'RATE_LIMITED' ? 'AUTH_CONTEXT_RATE_LIMITED' : 'AUTH_CONTEXT_RESOURCE_LIMIT');
          await protection.beforeRequest(contextSignal);
          options.budget.remaining--; result.requests++; requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
          if (browser) { browserRequests++; result.browserRequests++; }
          return release;
        } catch (error) { release(); throw error; }
      },
    };
    const headers = async (url: string) => {
      if (context === 'ANONYMOUS') return {};
      const credential = await loadReconCredential(execution.targetId, context, url);
      if (!credential) { local.abort(new Error('AUTH_CONTEXT_SESSION_UNAVAILABLE')); throw new Error('AUTH_CONTEXT_SESSION_UNAVAILABLE'); }
      return credentialHeaders(credential);
    };
    try { return await withTargetExecution({ ...execution, host:new URL(origin).host,programReconId: undefined, authenticatedOrigin: origin, authenticatedRequestHeaders: headers, requestGuard: guard }, () => work(guard)); }
    finally { guard.close(); }
  }
  function fail(context: Context, error: unknown) {
    options.signal.throwIfAborted(); throwIfScanAborted();
    const key = keyOf(context), reason = fixedReason(error);
    const state = reason === 'AUTH_CONTEXT_SESSION_UNAVAILABLE' ? 'SKIPPED_SESSION_UNAVAILABLE' : reason === 'AUTH_CONTEXT_SESSION_LOST' ? 'SKIPPED_SESSION_LOST' : reason === 'AUTH_CONTEXT_RATE_LIMITED' ? 'BLOCKED' : 'PARTIAL';
    const code=reason==='AUTH_CONTEXT_TRANSPORT_ERROR'?'INTERNAL_AUTH_RECON_FAILURE':reason;
    contextState.set(key, { contextKey: key, state, reason, failure:classifyReconFailure(code,'AUTHENTICATED_MAPPING','guarded-auth-mapper') }); stopped.add(key); result.complete = false;
  }
  async function record(context: Context, page: ProbeResult & { bodyAvailable?: boolean }, source: string) {
    const observation=await recordSurfaceObservation(options.scanRunId, options.scopeAssetId, context, page, source);
    // Contextual response status belongs to SurfaceObservation. A canonical
    // endpoint adds discoverability/provenance without replacing anonymous 401
    // or 403 with a privileged session's 200 response.
    if(context!=='ANONYMOUS'&&observation&&page.status>0){
      const reference=`ReconSurfaceObservation:${observation.id}:${context.contextKey}`;
      const emit=async(kind:ArtifactKind,url:string,extra:Record<string,unknown>={})=>{
        try{assertExecutionUrl(url,execution);if(new URL(url).origin!==origins.get(context.contextKey))return;}catch{return;}
        const safe=safeSurfaceUrl(url);
        await options.onArtifact?.(kind,{url:safe,...extra,safeForActiveReview:safe===url&&isSafeReadUrl(url),authentication:'authenticated-context-observed'},reference,context.contextKey);
      };
      await emit('endpoint',page.url,{method:page.method});
      if(page.bodyAvailable!==false&&surfaceResponseClass(page)==='CONTENT'){
        const corpus=analyzeCorpus({html:page.body,urls:[page.url],pages:[page],authenticated:true},page.url);
        for(const form of corpus.forms){await emit('endpoint',form.url,{declaredMethod:form.method,type:'observed-form'});for(const name of form.fields)await emit('parameter',form.url,{name});}
        for(const parameter of corpus.queryInputs)await emit('parameter',parameter.url,{name:parameter.key});
        for(const url of corpus.apiUrls)await emit('api-surface',url,{type:'observed-route'});
        for(const url of corpus.authUrls)await emit('auth-surface',url,{type:'observed-route'});
        if(/json/i.test(page.headers['content-type']??''))try{
          const spec=JSON.parse(page.body);
          if((spec.openapi||spec.swagger)&&spec.paths&&typeof spec.paths==='object')for(const [path,methods]of Object.entries(spec.paths).slice(0,40))if(methods&&typeof methods==='object')for(const method of Object.keys(methods).filter(value=>/^(get|head|post|put|patch|delete|options)$/i.test(value)))await emit('endpoint',new URL(path,page.url).toString(),{declaredMethod:method.toUpperCase(),type:'api-specification'});
        }catch{/* Response bodies are transient; malformed JSON is not an API declaration. */}
      }
    }
    if (page.status === 429 || page.status >= 500 || page.error || page.status === 403 && /captcha|request (?:blocked|rejected)|cloudflare[\s\S]{0,80}challenge/i.test(page.body)) protection.observe(page.error ? undefined : page.status, page.error);
    if (page.status === 429) throw new Error('AUTH_CONTEXT_RATE_LIMITED');
    if (context !== 'ANONYMOUS' && page.url === validations.get(context.contextKey) && ['DENIED', 'LOGIN_REDIRECT'].includes(surfaceResponseClass(page))) throw new Error('AUTH_CONTEXT_SESSION_LOST');
    if(context!=='ANONYMOUS'&&surfaceResponseClass(page)==='LOGIN_REDIRECT'){
      const validation=validations.get(context.contextKey);
      if(validation&&page.url!==validation){
        const verified=await probe(validation,{signal,timeoutMs:5000,maxBodyBytes:32768});
        await record(context,verified,'authenticated-session-validation');
        if(verified.error||!verified.status||verified.status>=500)throw new Error('AUTH_CONTEXT_TRANSPORT_ERROR');
      }
    }
  }
  async function native(context: Context, seeds: string[]) {
    const key = keyOf(context), visited = observed.get(key)!, origin = origins.get(key)!;
    const queue = [...new Set(seeds)].filter(url => allowed(url, origin)).map(url => ({ url, depth: 0 }));
    const prioritize=()=>queue.sort((a,b)=>Number(b.url===validations.get(key))-Number(a.url===validations.get(key))||surfacePriority(a.url)-surfacePriority(b.url)||a.depth-b.depth||a.url.localeCompare(b.url));
    prioritize();
    await inContext(context, async () => {
      while (queue.length && (nativePages.get(key) ?? 0) < limits.maxPagesPerContext) {
        signal.throwIfAborted(); const { url, depth } = queue.shift()!;
        if (visited.has(url) || !allowed(url, origin)) continue;
        const cached = context === 'ANONYMOUS' ? options.anonymousPages?.get(url) : undefined;
        const page = cached && !cached.error && cached.status > 0 ? cached : await probe(url, { signal, timeoutMs: 5000, maxBodyBytes: 32768 });
        visited.add(url); nativePages.set(key, (nativePages.get(key) ?? 0) + 1);
        await record(context, page, 'authenticated-mapper');
        if (page.error || !page.status || page.status>=500) throw new Error(page.error ?? 'AUTH_CONTEXT_TRANSPORT_ERROR');
        if (/html/i.test(page.headers['content-type'] ?? '')) htmlStarts.set(key, htmlStarts.get(key) ?? url);
        if (depth < limits.maxDepth && surfaceResponseClass(page) === 'CONTENT') for (const link of links(page.body, page.url)) {
          if (!allowed(link, origin)) continue;
          sharedUrls.add(link);
          if (!visited.has(link) && queue.length < limits.maxPagesPerContext * 3) queue.push({ url: link, depth: depth + 1 });
        }
        prioritize();
      }
    });
  }
  async function browser(context: Context) {
    const key = keyOf(context), start = htmlStarts.get(key); if (!start || options.browser === false || !limits.browserPages) return;
    if (options.budget.remaining <= 0 || result.requests >= limits.maxRequests) { result.warnings.push('AUTH_MAPPING_BROWSER_SKIPPED_RESOURCE_LIMIT'); return; }
    await inContext(context, async guard => {
      guard.signal.throwIfAborted();
      const instance = await launchTargetBrowser({ headless: true, timeout:5000 });
      let browserContext: Awaited<ReturnType<typeof newTargetBrowserContext>> | undefined;
      const pending: Promise<unknown>[] = [];
      try {
        browserContext = await newTargetBrowserContext(instance);
        browserContext.on('response', response => {
          if (pending.length >= limits.browserRequestsPerContext) return;
          const request = response.request(), url = response.url();
          if (!allowed(url, origins.get(key)) || !['GET', 'HEAD'].includes(request.method())) return;
          const task = (async () => {
            const headers = await response.allHeaders(); if (headers['x-bughunter-redirect-location']) headers.location = headers['x-bughunter-redirect-location'];
            await record(context, { url, method: request.method(), status: response.status(), headers, body: '', bodyLen: 0, ms: 0, bodyAvailable: false }, 'authenticated-browser');
            observed.get(key)!.add(url);
          })();
          void task.catch(()=>{}); pending.push(task);
        });
        const page = await browserContext.newPage();
        await page.goto(start, { waitUntil: 'domcontentloaded', timeout: 3000 });
        guard.signal.throwIfAborted();
        const discovered = await page.locator('a[href]').evaluateAll(elements => elements.slice(0, 50).map(element => element.getAttribute('href') ?? ''));
        for (const value of discovered) { try { const url = new URL(value, start).toString(); if (allowed(url, origins.get(key))) sharedUrls.add(url); } catch { /* documentary malformed reference */ } }
      } catch(error) { if(guard.signal.aborted)throw guard.signal.reason;throw error; }
      finally { await browserContext?.close().catch(() => {}); await instance.close().catch(() => {});guard.close();await Promise.all(pending); }
    }, true);
  }

  const verifiedOrigin=options.snapshot.contexts.find(context=>context.eligibility==='PLANNED'&&context.validationUrl)?.validationUrl;
  for (const context of contexts) {
    const key = keyOf(context); observed.set(key, new Set()); nativePages.set(key, 0);
    const possibleOrigin = context === 'ANONYMOUS' ? verifiedOrigin?new URL(verifiedOrigin).origin:undefined : context.validationUrl ? new URL(context.validationUrl).origin : undefined;
    const base = options.seeds.find(url => allowed(url, possibleOrigin));
    if (!base) { fail(context, new Error('AUTH_CONTEXT_SCOPE_BLOCKED')); continue; }
    origins.set(key, new URL(base).origin);
    try {
      signal.throwIfAborted();
      let seeds = [base];
      if (context !== 'ANONYMOUS') {
        assertExecutionUrl(base, execution);
        const credential = await withTargetExecution({...execution,host:new URL(base).host,programReconId:undefined},()=>loadReconCredential(execution.targetId, context, base));
        if (!credential) throw new Error('AUTH_CONTEXT_SESSION_UNAVAILABLE');
        const rawValidation = credential.validationUrl;
        if (rawValidation && allowed(rawValidation, origins.get(key))) { validations.set(key, rawValidation); seeds.unshift(rawValidation); sharedUrls.add(rawValidation); }
        if (credential.ownedObjectUrl && allowed(credential.ownedObjectUrl, origins.get(key))) { seeds.push(credential.ownedObjectUrl); sharedUrls.add(credential.ownedObjectUrl); }
      }
      seeds = [...new Set([...seeds, ...sharedUrls])];
      await native(context, seeds);
      try { await browser(context); } catch (error) { options.signal.throwIfAborted(); throwIfScanAborted(); result.warnings.push('AUTH_MAPPING_BROWSER_LIMITED'); if (/AUTH_CONTEXT_SESSION/.test(String(error))) throw error; }
    } catch (error) { fail(context, error); }
  }
  // Backfill identical observed URLs, never reconstructed redacted URL seeds.
  for (const context of contexts) if (!stopped.has(keyOf(context))) {
    try { await native(context, [...sharedUrls]); } catch (error) { fail(context, error); }
  }
  for (const context of contexts) {
    const key = keyOf(context), previous = contextState.get(key);
    result.contexts.push({ contextKey: key, state: previous?.state ?? 'COMPLETED', ...(previous?.reason ? { reason: previous.reason } : {}), ...(previous?.failure?{failure:previous.failure}:{}), requests: requestCounts.get(key) ?? 0, pages: observed.get(key)?.size ?? 0 });
    if (!previous && [...sharedUrls].some(url => allowed(url, origins.get(key)) && !observed.get(key)?.has(url))) result.warnings.push('AUTH_MAPPING_BOUNDED_COVERAGE');
  }
  result.warnings = [...new Set(result.warnings)];
  return result;
}
