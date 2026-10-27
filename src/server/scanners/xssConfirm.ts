import { currentScanControl, throwIfScanAborted } from "@/server/scanControl";
import { launchTargetBrowser, newTargetBrowserContext } from "@/server/execution";
import { payloadVariant } from "@/lib/hunt/payloads";
// Headless DOM-XSS confirmation (web2-vuln-classes SKILL §3, confirmation stage).
//
// EPISTEMIC HONESTY is the whole point. The static pass in xss.ts records every
// DOM sink at confidence CANDIDATE and never claims execution — a sink appearing
// in client code is a lead, not a proof. This module is the ONLY place allowed to
// move a DOM-XSS finding to PROVEN, and it does so on exactly one condition: we
// drove an attacker-controllable source and watched real JavaScript execute in a
// headless Chromium (an alert()/confirm()/prompt() dialog carrying our unique
// canary). No dialog → confirmed:false with an explicit reason. We never infer
// execution from a reflection, a console line, or the mere presence of the sink.
//
// This is best-effort: we cannot know the exact source→sink wiring from a static
// grep, so we try the sources DOM sinks most commonly read from (location.hash
// and a query param) with a handful of breakout payloads. A false (not confirmed)
// here means "could not prove it anonymously within the budget", NOT "safe".
//
// Hard operational constraints (Agent K's containerized Chromium):
//   - launch with --no-sandbox (no in-container sandbox) + --disable-dev-shm-usage
//   - the browser binary lives at PLAYWRIGHT_BROWSERS_PATH=/ms-playwright; Playwright
//     reads that from the environment, so it is never hardcoded here
//   - the whole confirmation is bounded to ~12s and NEVER throws: a failure in the
//     confirmer must never crash the hunt.

import {
  type Browser,
  type BrowserContext,
  type Dialog,
  type Page,
} from "playwright-chromium";

/** Overall wall-clock budget for one confirmXssSink() call, including launch. */
const OVERALL_DEADLINE_MS = 12_000;
/** Per-navigation page-load cap (further clamped by the remaining budget). */
const PAGE_LOAD_TIMEOUT_MS = 9_000;
/** Grace window after load for an async onerror/onload to fire the dialog. */
const DIALOG_GRACE_MS = 1_500;
/** Below this remaining budget there is no point starting another navigation. */
const MIN_CANDIDATE_BUDGET_MS = 1_500;

/** Chromium launch args required by the container (see header). */
const LAUNCH_ARGS = ["--no-sandbox", "--disable-dev-shm-usage"] as const;

export interface XssSinkInfo {
  /** Sink name exactly as xss.ts recorded it (e.g. 'innerHTML =', 'location sink'). */
  sink: string;
  /** Where the sink was found (JS file URL), carried through for the note. */
  location?: string;
  /** Optional caller-supplied canary id; one is generated when absent. */
  canaryId?: string;
  parameter?: string;
  context?: "HTML" | "ATTRIBUTE" | "JAVASCRIPT" | "UNKNOWN";
  authentication?: { cookies?: Record<string, string>; bearerToken?: string };
}

export interface XssConfirmResult {
  /** A required browser control could not execute (distinct from no vulnerability). */
  executionIncomplete?: boolean;
  confirmed: boolean;
  evidence?: string;
  reason?: string;
}

interface Candidate {
  /** The fully-built URL to navigate to. */
  url: string;
  /** Human description of the source we drove (for the evidence string). */
  via: string;
  controlUrl: string;
}

/**
 * Build the candidate URLs to try, injecting the canary payload through the
 * sources DOM sinks most commonly read from. We cannot know the real wiring, so
 * this is a prioritized best-effort list; the deadline decides how many we reach.
 */
function buildCandidates(url: string, canaryId: string, info: XssSinkInfo): Candidate[] {
  const base = new URL(url); base.hash = "";
  const key = info.parameter ?? [...base.searchParams.keys()][0] ?? "q";
  const preferred = info.context === "JAVASCRIPT" ? "xss.javascript" : info.context === "ATTRIBUTE" ? "xss.attribute" : "xss.html";
  const query = (id: string): Candidate => {
    const u = new URL(base), control = new URL(base);
    u.searchParams.set(key, payloadVariant(id).build("", canaryId));
    control.searchParams.set(key, canaryId);
    return { url: u.toString(), controlUrl: control.toString(), via: `query ${key} (${id})` };
  };
  return [query(preferred), { url: `${base}#${payloadVariant("xss.html").build("", canaryId)}`, controlUrl: `${base}#${canaryId}`, via: "location.hash (HTML)" }, query(preferred === "xss.attribute" ? "xss.javascript" : "xss.attribute")];
}

/**
 * Load one candidate URL in a fresh page and wait, within `budgetMs`, for a
 * dialog carrying the canary. Returns the dialog message on real execution, or a
 * short failure reason. Never throws.
 */
async function tryCandidate(
  context: BrowserContext,
  candidate: Candidate,
  canaryId: string,
  budgetMs: number,
): Promise<{ fired: true; message: string } | { fired: false; reason: string }> {
  let page: Page | null = null;
  let firedMessage: string | null = null;

  try {
    page = await context.newPage();

    // Require the exact canary. The separate inert input control rejects normal
    // application dialog echoes. Always dismiss so the page never blocks.
    page.on("dialog", (dialog: Dialog) => {
      const message = dialog.message();
      void dialog.dismiss().catch(() => {});
      if (firedMessage === null && message === canaryId) {
        firedMessage = message;
      }
    });

    const navTimeout = Math.max(
      500,
      Math.min(PAGE_LOAD_TIMEOUT_MS, budgetMs - DIALOG_GRACE_MS),
    );

    let navStatus: number | null = null;
    let navError: string | null = null;
    try {
      const resp = await page.goto(candidate.url, {
        waitUntil: "domcontentloaded",
        timeout: navTimeout,
      });
      navStatus = resp ? resp.status() : null;
    } catch (err) {
      navError = err instanceof Error ? err.message : String(err);
    }

    // The dialog may fire during load (sync) or shortly after (async onerror).
    // Poll briefly, bounded by whatever budget remains, resolving the instant it
    // fires.
    const graceMs = Math.max(0, Math.min(DIALOG_GRACE_MS, budgetMs - 200));
    await waitFor(() => firedMessage !== null, graceMs);

    if (firedMessage !== null) {
      return { fired: true, message: firedMessage };
    }
    if (navError) {
      return { fired: false, reason: `page load failed: ${navError}` };
    }
    if (navStatus !== null && navStatus >= 400) {
      return { fired: false, reason: `navigation returned ${navStatus}` };
    }
    return { fired: false, reason: "no dialog/canary observed" };
  } catch (err) {
    return {
      fired: false,
      reason: `candidate errored: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}

/** Resolve once `predicate()` is true or `timeoutMs` elapses. Never rejects. */
function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  if (predicate() || timeoutMs <= 0 || currentScanControl()?.signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      if (predicate() || currentScanControl()?.signal.aborted) {
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
 * Confirm a DOM-XSS sink by actually executing a canary payload in headless
 * Chromium. Returns confirmed:true ONLY when a dialog carrying the canary fired —
 * real execution. Otherwise confirmed:false with an explicit reason. Never throws.
 */
export async function confirmXssSink(
  url: string,
  sinkInfo: XssSinkInfo,
): Promise<XssConfirmResult> {
  throwIfScanAborted();
  const started = Date.now();
  const deadline = started + OVERALL_DEADLINE_MS;

  // Validate the target up front — a bad URL is a clean, non-throwing failure.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { confirmed: false, reason: `invalid URL: ${url}` };
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return {
      confirmed: false,
      reason: `unsupported scheme "${parsed.protocol}" (only http/https)`,
    };
  }

  const canaryId =
    sinkInfo.canaryId?.trim() || `xssc${Math.random().toString(36).slice(2, 10)}`;
  if (!/^[A-Za-z0-9_-]{1,96}$/.test(canaryId)) return { confirmed: false, reason: "invalid execution canary" };
  const candidates = buildCandidates(url, canaryId, sinkInfo);

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  let overallTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    // A fresh context per call — no cookies/state shared between targets.
    browser = await launchTargetBrowser({ headless: true, args: [...LAUNCH_ARGS], timeout: Math.max(1, Math.min(5000, deadline - Date.now())) });
    context = await newTargetBrowserContext(browser);
    if (sinkInfo.authentication?.cookies) await context.addCookies(Object.entries(sinkInfo.authentication.cookies).map(([name, value]) => ({ name, value, url: parsed.origin })));
    if (sinkInfo.authentication?.bearerToken) await context.setExtraHTTPHeaders({ Authorization: `Bearer ${sinkInfo.authentication.bearerToken}` });

    const confirm = runCandidates(context, candidates, canaryId, sinkInfo, url, deadline);

    // Belt-and-braces overall deadline: even if a candidate somehow hangs past
    // its own timeout, the whole call returns by ~12s. The finally below still
    // tears the browser down, so no Chromium process leaks.
    const overall = new Promise<XssConfirmResult>((resolve) => {
      overallTimer = setTimeout(
        () =>
          resolve({
            confirmed: false,
            executionIncomplete: true,
            reason: `no dialog/canary observed within ${OVERALL_DEADLINE_MS / 1000}s`,
          }),
        Math.max(0, deadline - Date.now()),
      );
    });

    return await Promise.race([confirm, overall]);
  } catch (err) {
    throwIfScanAborted();
    return {
      confirmed: false,
      executionIncomplete: true,
      reason: `browser launch/run failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(overallTimer);
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

/** Walk the candidates in priority order until one fires or the budget runs out. */
async function runCandidates(
  context: BrowserContext,
  candidates: Candidate[],
  canaryId: string,
  sinkInfo: XssSinkInfo,
  originalUrl: string,
  deadline: number,
): Promise<XssConfirmResult> {
  const reasons: string[] = [];
  let executionIncomplete = false;
  for (const candidate of candidates) {
    throwIfScanAborted();
    const remaining = deadline - Date.now();
    if (remaining < MIN_CANDIDATE_BUDGET_MS) {
      executionIncomplete = true;
      reasons.push("budget exhausted before all sources tried");
      break;
    }
    const control = await tryCandidate(context, { ...candidate, url: candidate.controlUrl, via: "inert canary control" }, canaryId, remaining);
    if (control.fired) return { confirmed: false, reason: "inert canary control also triggered a dialog; application dialog echo is not injected execution" };
    if (control.reason !== "no dialog/canary observed") { executionIncomplete = true; reasons.push("inert control unavailable"); continue; }
    if (deadline - Date.now() < MIN_CANDIDATE_BUDGET_MS) { executionIncomplete = true; break; }
    const result = await tryCandidate(context, candidate, canaryId, deadline - Date.now());
    if (result.fired) {
      const where = sinkInfo.location ? ` (sink seen at ${sinkInfo.location})` : "";
      return {
        confirmed: true,
        evidence:
          `alert() fired with canary "${canaryId}" via ${candidate.via} on ${originalUrl} ` +
          `— confirms XSS sink "${sinkInfo.sink}"${where} after an inert canary control. ` +
          `Dialog message: ${result.message}`,
      };
    }
    if (result.reason !== "no dialog/canary observed") executionIncomplete = true;
    reasons.push(`${candidate.via}: ${result.reason}`);
  }

  // No execution observed on any source we could reach in time. Report WHY, so
  // the finding stays a CANDIDATE rather than being silently dropped or inflated.
  return {
    confirmed: false,
    executionIncomplete,
    reason:
      `no dialog/canary observed within ${OVERALL_DEADLINE_MS / 1000}s for sink ` +
      `"${sinkInfo.sink}" [${reasons.join("; ") || "no candidates attempted"}]`,
  };
}
