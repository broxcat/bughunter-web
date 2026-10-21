// Automatic session acquisition for EMAIL_PASSWORD target credentials.
//
// Instead of pasting cookies from devtools (which expire), the operator gives an
// email + password + login URL for the TARGET, and we log in via the headless
// Chromium already used by the XSS/CSRF scanners to mint/refresh session cookies.
//
// Same operational constraints as xssConfirm.ts (Agent K's containerized Chromium):
// launch with --no-sandbox + --disable-dev-shm-usage, a fresh context closed in a
// finally (no leaked browser), a bounded wall-clock budget, and it NEVER throws —
// a failed login returns { cookies: {}, error } so an authenticated scan degrades
// to "credential unavailable" rather than crashing the hunt.
//
// SECURITY: email/password arrive already decrypted from the caller and are only
// typed into the target's login form. They are NEVER logged. The returned cookies
// are session material for the TARGET and are handled like every other secret.

import { chromium, type Browser, type BrowserContext } from "playwright-chromium";

const LAUNCH_ARGS = ["--no-sandbox", "--disable-dev-shm-usage"] as const;

/** Overall wall-clock budget for one acquireSessionCookies() call. */
const OVERALL_DEADLINE_MS = 20_000;
const NAV_TIMEOUT_MS = 12_000;
/** Grace after submit for the post-login navigation / state change. */
const POST_SUBMIT_WAIT_MS = 6_000;
/** Max wait for a client-rendered (SPA/Auth.js) login form to hydrate. */
const FORM_HYDRATE_MS = 10_000;
/** A cookie name that looks like a real session (so we can poll for it post-login). */
const SESSION_COOKIE_RE = /(session[._-]?token|sessionid|connect\.sid|jwt|auth.*token)/i;

const EMAIL_SELECTORS = [
  'input[type="email"]',
  'input[name="email"]',
  'input[name="username"]',
  'input[name="login"]',
  'input[name="user"]',
  'input[id="email"]',
  'input[id="username"]',
  'input[autocomplete="username"]',
];
const PASSWORD_SELECTORS = [
  'input[type="password"]',
  'input[name="password"]',
  'input[id="password"]',
  'input[autocomplete="current-password"]',
];
const SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button[name="login"]',
  "form button",
  "button",
];

export interface AutoLoginInput {
  loginUrl: string;
  email: string;
  password: string;
}

export interface AutoLoginResult {
  cookies: Record<string, string>;
  error?: string;
}

async function fillFirst(
  page: import("playwright-chromium").Page,
  selectors: string[],
  value: string,
): Promise<boolean> {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if ((await el.count()) > 0) {
      try {
        await el.fill(value, { timeout: 2_000 });
        return true;
      } catch {
        // try the next selector
      }
    }
  }
  return false;
}

/**
 * Log in to the target and return its session cookies as a name->value map.
 * Best-effort and total: every failure path returns { cookies: {}, error } and
 * nothing throws into the caller.
 */
export async function acquireSessionCookies(
  input: AutoLoginInput,
): Promise<AutoLoginResult> {
  const { loginUrl } = input;
  if (!/^https?:\/\//i.test(loginUrl)) {
    return { cookies: {}, error: `invalid loginUrl (must be http/https): ${loginUrl}` };
  }

  const deadline = Date.now() + OVERALL_DEADLINE_MS;
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  try {
    browser = await chromium.launch({ headless: true, args: [...LAUNCH_ARGS] });
    context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(loginUrl, {
        waitUntil: "domcontentloaded",
        timeout: Math.min(NAV_TIMEOUT_MS, Math.max(1_000, deadline - Date.now())),
      });
    } catch (e) {
      return { cookies: {}, error: `could not load login page: ${errMsg(e)}` };
    }

    // The target may be a client-rendered SPA (React / Auth.js): the form inputs
    // exist only after hydration, so `domcontentloaded` fires before they appear.
    // Wait for an email/username field to be VISIBLE before filling, or we'd
    // immediately (and wrongly) conclude there is no login form.
    try {
      await page
        .locator(EMAIL_SELECTORS.join(", "))
        .first()
        .waitFor({
          state: "visible",
          timeout: Math.min(FORM_HYDRATE_MS, Math.max(1_000, deadline - Date.now())),
        });
    } catch {
      return {
        cookies: {},
        error:
          "login form never rendered an email/username field (client-render not hydrated in time, or selectors do not match)",
      };
    }

    const emailFilled = await fillFirst(page, EMAIL_SELECTORS, input.email);
    if (!emailFilled) {
      return { cookies: {}, error: "could not find an email/username field on the login page" };
    }
    const passwordFilled = await fillFirst(page, PASSWORD_SELECTORS, input.password);
    if (!passwordFilled) {
      return { cookies: {}, error: "could not find a password field on the login page" };
    }

    // Submit: prefer a navigation, but tolerate SPA logins that just swap state.
    let submitted = false;
    for (const sel of SUBMIT_SELECTORS) {
      const el = page.locator(sel).first();
      if ((await el.count()) === 0) continue;
      try {
        await Promise.all([
          page
            .waitForLoadState("networkidle", {
              timeout: Math.min(POST_SUBMIT_WAIT_MS, Math.max(1_000, deadline - Date.now())),
            })
            .catch(() => {}),
          el.click({ timeout: 2_000 }),
        ]);
        submitted = true;
        break;
      } catch {
        // try the next submit candidate
      }
    }
    if (!submitted) {
      return { cookies: {}, error: "could not find/click a submit control on the login form" };
    }

    // Auth.js (and similar) set the session cookie asynchronously — a POST to the
    // credentials callback, then a redirect — so it is not present the instant the
    // click resolves. Poll the context for a session-looking cookie within the
    // remaining budget rather than reading once after a fixed wait.
    let cookies: Record<string, string> = {};
    const readCookies = async () => {
      const raw = await context!.cookies().catch(() => []);
      const map: Record<string, string> = {};
      for (const c of raw) if (c.name) map[c.name] = c.value;
      return map;
    };
    while (Date.now() < deadline) {
      cookies = await readCookies();
      if (Object.keys(cookies).some((n) => SESSION_COOKIE_RE.test(n))) break;
      await page.waitForTimeout(400).catch(() => {});
    }
    // Final read in case the loop exited on the deadline mid-set.
    if (Object.keys(cookies).length === 0) cookies = await readCookies();

    if (Object.keys(cookies).length === 0) {
      return { cookies: {}, error: "login submitted but no cookies were set (wrong credentials or unexpected flow?)" };
    }

    // Heuristic: a password field still present often means login failed.
    const stillHasPassword = (await page.locator('input[type="password"]').count()) > 0;
    if (stillHasPassword) {
      return {
        cookies,
        error: "a password field is still present after submit — login may have failed (returning cookies anyway for inspection)",
      };
    }

    return { cookies };
  } catch (e) {
    return { cookies: {}, error: `auto-login failed: ${errMsg(e)}` };
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
