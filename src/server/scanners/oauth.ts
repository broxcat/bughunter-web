// OAuth misconfiguration scanner (web2-vuln-classes SKILL — OAuth/SSO abuse).
//
// Two checks against the OAuth authorization endpoints discovered by the shared
// authenticated crawl. We never initiate a real OAuth grant — these are GET
// probes only (probe() uses redirect:"manual", so a 30x Location is OBSERVED,
// never followed to a third party).
//
//   Test 1 — unvalidated redirect_uri (PROVEN/HIGH or nothing):
//     If the authorization endpoint redirects to an attacker-controlled URI, an
//     attacker can steal the authorization code/token. We send the external test
//     URI and confirm PROVEN only when the response actually 30x-redirects to the
//     external host (Location header). A same-origin redirect or an error page is
//     correct behaviour — no finding, no inflation.
//
//   Test 2 — missing `state` on the observed flow (CANDIDATE/MEDIUM):
//     Absence of a `state` parameter is a CSRF-on-OAuth *signal*, not a proven
//     exploit (a real PoC needs a victim flow), so it stays CANDIDATE.
//
// Best-effort and NEVER throwing — any failure is a logged skip, never an abort.

import { probe } from "./http";
import { discoverCorpus } from "./discovery";
import { logLine, recordFinding, type ScanContext } from "./context";

// Bound the work: authorization endpoints to probe per run.
const MAX_ENDPOINTS = 15;
// Arbitrary attacker-controlled origin — intentionally a .example reserved TLD.
const EVIL_REDIRECT = "https://evil-bughunter-test.example/cb";
const EVIL_HOST = "evil-bughunter-test.example";
// Redirect-carrying parameter names to probe for Test 1.
const REDIRECT_PARAMS = ["redirect_uri", "callback_url", "return_to", "redirect", "next"];
// Params that mark a URL as a genuine OAuth *authorization request* (vs. a bare
// /authorize path or a callback) — used to gate the missing-state check so it
// doesn't fire noise on endpoints that were never an initiated flow.
const AUTH_REQUEST_PARAMS = ["client_id", "response_type", "redirect_uri", "scope"];
// Pathname patterns that identify an OAuth authorization / callback endpoint.
const OAUTH_PATH_RE =
  /(\/oauth2?\/authorize|\/connect\/authorize|\/login\/oauth\/authorize|\/authorize(?:$|[/?])|\/api\/auth\/callback\/|\/auth\/realms\/)/i;

/** Same-origin OAuth authorization endpoints found in the corpus, deduped by path. */
function oauthEndpoints(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      continue;
    }
    if (!OAUTH_PATH_RE.test(parsed.pathname)) continue;
    // Dedupe on origin+pathname (query varies; we add our own for Test 1).
    const key = parsed.origin + parsed.pathname;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
    if (out.length >= MAX_ENDPOINTS) break;
  }
  return out;
}

/** Does `location` point at the attacker-controlled external host? */
function redirectsToEvil(location: string | undefined, baseUrl: string): boolean {
  if (!location) return false;
  try {
    // Resolve against the endpoint so a relative Location is judged correctly:
    // a relative Location can NEVER reach an external host, so it is safe.
    const abs = new URL(location, baseUrl);
    return abs.host === EVIL_HOST;
  } catch {
    // Not a parseable URL — but a raw concatenation like "...?x=https://evil..."
    // could still carry it; only flag if the external host literally appears as
    // the redirect target scheme://host, not merely as a substring somewhere.
    return new RegExp(`https?://${EVIL_HOST.replace(/\./g, "\\.")}`, "i").test(location);
  }
}

/** Is a 3xx with a Location header. */
function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

/**
 * Does the discovered URL look like a genuine OAuth authorization REQUEST (an
 * initiated flow), i.e. it carries at least one authorization parameter? A bare
 * `/authorize` path or a callback URL does not, and flagging those for a missing
 * `state` would be noise, not a signal.
 */
function looksLikeAuthRequest(endpointUrl: string): boolean {
  try {
    const params = new URL(endpointUrl).searchParams;
    return AUTH_REQUEST_PARAMS.some((p) => params.has(p));
  } catch {
    return false;
  }
}

/** Whether the authorization request as observed carries a `state` parameter. */
function hasStateParam(endpointUrl: string, html: string): boolean {
  try {
    if (new URL(endpointUrl).searchParams.has("state")) return true;
  } catch {
    /* ignore */
  }
  // Look for the endpoint being initiated WITH a state param anywhere in the
  // crawled HTML (href/action that targets this path and includes state=).
  let path: string;
  try {
    path = new URL(endpointUrl).pathname;
  } catch {
    return false;
  }
  const esc = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(esc + "[^\"'\\s>]*[?&]state=", "i");
  return re.test(html);
}

export async function runOauth(ctx: ScanContext): Promise<void> {
  await logLine(ctx.scanRunId, `[oauth] scanning ${ctx.baseUrl} for OAuth misconfiguration`);

  const corpus = await discoverCorpus(ctx);
  if (!corpus.html) {
    await logLine(ctx.scanRunId, `[oauth] could not crawl ${ctx.baseUrl} — skipping`, "STDERR");
    return;
  }
  if (corpus.authenticated) {
    await logLine(ctx.scanRunId, `[oauth] using authenticated crawl (${corpus.urls.length} URLs)`);
  }

  const endpoints = oauthEndpoints(corpus.urls);
  if (endpoints.length === 0) {
    await logLine(
      ctx.scanRunId,
      "[oauth] no OAuth authorization endpoints found in corpus — skipping",
    );
    return;
  }
  await logLine(ctx.scanRunId, `[oauth] ${endpoints.length} OAuth endpoint(s) to test`);

  let openRedirects = 0;
  let missingState = 0;

  for (const endpoint of endpoints) {
    // --- Test 1: unvalidated redirect_uri -> external host -------------------
    for (const param of REDIRECT_PARAMS) {
      let probeUrl: string;
      try {
        const u = new URL(endpoint);
        u.searchParams.set(param, EVIL_REDIRECT);
        probeUrl = u.toString();
      } catch {
        continue;
      }
      const res = await probe(probeUrl, { timeoutMs: 10_000 });
      if (res.error) continue;
      if (isRedirect(res.status) && redirectsToEvil(res.headers["location"], endpoint)) {
        openRedirects++;
        await recordFinding(ctx, {
          title: `OAuth unvalidated redirect_uri on ${new URL(endpoint).pathname}`,
          vulnClass: "OAuth Misconfiguration",
          severity: "HIGH",
          confidence: "PROVEN",
          location: endpoint,
          description:
            `The authorization endpoint honours an attacker-controlled "${param}" and ` +
            `redirects the browser to an external host. In an OAuth flow this lets an ` +
            `attacker steal the authorization code/token by having it delivered to their ` +
            `own URI. Confirmed directly from the ${res.status} Location header — no ` +
            `whitelist validation of the redirect target.`,
          evidence:
            `GET ${probeUrl}\n` +
            `→ HTTP ${res.status}\n` +
            `Location: ${res.headers["location"] ?? "(none)"}`,
        });
        await logLine(
          ctx.scanRunId,
          `[oauth] OPEN REDIRECT (confirmed) ${new URL(endpoint).pathname} via ${param}`,
        );
        break; // one Test-1 finding per endpoint
      }
    }

    // --- Test 2: missing state parameter (CSRF-on-OAuth signal) --------------
    // Only judge endpoints that were observed as a real authorization request;
    // bare /authorize paths and callbacks carry no auth params and are not noise
    // we should flag.
    if (looksLikeAuthRequest(endpoint) && !hasStateParam(endpoint, corpus.html)) {
      missingState++;
      await recordFinding(ctx, {
        title: `OAuth flow missing "state" parameter on ${new URL(endpoint).pathname}`,
        vulnClass: "OAuth Misconfiguration",
        severity: "MEDIUM",
        confidence: "CANDIDATE",
        location: endpoint,
        description:
          `The OAuth authorization request as observed carries no "state" parameter. ` +
          `A missing/unverified state defeats CSRF protection on the OAuth flow, which ` +
          `can enable login-CSRF / account linking attacks. This is a signal, not a ` +
          `proven exploit: confirming it requires a victim-flow PoC showing the callback ` +
          `is accepted without a bound, verified state. Recorded as CANDIDATE.`,
        evidence: `Authorization endpoint observed without a state parameter:\n${endpoint}`,
      });
      await logLine(
        ctx.scanRunId,
        `[oauth] missing state (candidate) ${new URL(endpoint).pathname}`,
      );
    }
  }

  await logLine(
    ctx.scanRunId,
    `[oauth] ${endpoints.length} endpoint(s), ${openRedirects} open-redirect, ${missingState} missing-state`,
  );
}
