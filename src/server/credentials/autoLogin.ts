import { throwIfScanAborted } from "@/server/scanControl";
import { assertExecutionUrl, currentTargetExecution, launchTargetBrowser, newTargetBrowserContext } from "@/server/execution";
import { isSafeReadUrl } from "@/lib/observationSafety";
import { type Browser, type BrowserContext } from "playwright-chromium";
import { detectCsrf } from "./csrf";

export interface AutoLoginInput {
  baseUrl?: string;
  loginUrl?: string; // legacy/internal discovered hint, never requested by the UI
  username?: string;
  email?: string; // encrypted legacy column compatibility
  password: string;
  allowLoginAction?: (url: string, detectedPasswordForm?: boolean, passwordField?: string) => void;
}
export interface AutoLoginResult {
  cookies: Record<string, string>;
  error?: string;
  rejected?: boolean;
  loginUrl?: string;
  candidateUrls?: string[];
  expiresAt?: Date;
  csrfSources?: string[];
  bearerToken?: string;
}
const usernameSelector = 'input[autocomplete="username"], input[type="email"], input[name="username"], input[name="email"], input[name="login"], input[name="user"], input[type="text"]';
/** Discover a visible password form, preserve hidden inputs and browser cookies. */
export async function acquireSessionCookies(input: AutoLoginInput): Promise<AutoLoginResult> {
  throwIfScanAborted();
  const base = input.baseUrl ?? input.loginUrl;
  if (!base) return { cookies: {}, error: "Login form unavailable" };
  let browser: Browser | null = null, context: BrowserContext | null = null;
  const deadline = Date.now() + 24000;
  try {
    const execution = currentTargetExecution();
    assertExecutionUrl(base);
    browser = await launchTargetBrowser({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"], timeout: 5000 });
    context = await newTargetBrowserContext(browser);
    const page = await context.newPage();
    const candidates = [base];
    if (input.loginUrl) { try { assertExecutionUrl(input.loginUrl); if (!candidates.includes(input.loginUrl)) candidates.push(input.loginUrl); } catch { /* stale legacy hints never bypass scope */ } }
    const observedHeaders: Record<string, string> = {};
    let bearerToken: string | undefined;
    page.on("request", request => {
      try { assertExecutionUrl(request.url(), execution); const value = request.headers().authorization; if (value && /^Bearer [A-Za-z0-9._~+\/-]+=*$/.test(value) && value.length <= 8192) bearerToken = value.slice(7); } catch { /* foreign auth material never retained */ }
    });
    page.on("response", response => { void response.allHeaders().then(headers => { for (const [k, v] of Object.entries(headers)) if (/^x-(csrf-token|xsrf-token|csrftoken)$/i.test(k)) observedHeaders[k] = v; }).catch(() => {}); });
    let found = false;
    for (let i = 0; i < Math.min(candidates.length, 5) && Date.now() < deadline; i++) {
      await page.goto(candidates[i], { waitUntil: "domcontentloaded", timeout: Math.min(5000, Math.max(1, deadline - Date.now())) }).catch(() => {});
      const password = page.locator('form input[type="password"]').first();
      try { await password.waitFor({ state: "visible", timeout: Math.min(1500, Math.max(1, deadline - Date.now())) }); found = true; break; } catch { /* next observed login link */ }
      if (i === 0) {
        const links = await page.locator("a[href]").evaluateAll(elements => elements.map(e => e.getAttribute("href") ?? ""));
        for (const raw of [...links.filter(v => /login|signin|sign-in|log-in/i.test(v)), "/login", "/signin"]) {
          try { const u = new URL(raw, base); assertExecutionUrl(u.toString()); if (isSafeReadUrl(u.toString()) && !candidates.includes(u.toString())) candidates.push(u.toString()); } catch { /* foreign links never grant scope */ }
        }
      }
    }
    if (!found) return { cookies: {}, error: "Login form unavailable" };
    const form = page.locator("form").filter({ has: page.locator('input[type="password"]') }).first();
    const loginUrl = page.url();
    const action = new URL(await form.getAttribute("action") || loginUrl, loginUrl).toString();
    const fields = await form.locator("input[name], select[name]").evaluateAll(elements => elements.map(e => e.getAttribute("name") ?? ""));
    const buttons = await form.locator('button, input[type="submit"]').evaluateAll(elements => elements.map(e => `${e.textContent ?? ""} ${e.getAttribute("value") ?? ""}`));
    const semantics = `${action} ${await form.getAttribute("id") ?? ""} ${buttons.join(" ")}`;
    if (!/login|log-in|signin|sign-in|sign in|log in|session|connexion|connecter|\/auth\b/i.test(semantics) || /register|sign.?up|create.account/i.test(semantics) || fields.some(f => /^(price|amount|total|quantity|qty|discount|coupon|currency|transfer|purchase)$/i.test(f))) return { cookies: {}, error: "A safe login form could not be identified" };
    const passwordField = await form.locator('input[type="password"]').first().getAttribute("name") ?? "password";
    if (new URL(action).origin !== new URL(base).origin) return { cookies: {}, error: "Login action is outside the selected origin" };
    assertExecutionUrl(action); input.allowLoginAction?.(action, true, passwordField);
    // AJAX login routes are accepted only when discovered in this form's scripts.
    const html = await page.content();
    for (const m of html.matchAll(/(?:fetch|post)\(\s*["']([^"']+)["']/gi)) {
      try { const u = new URL(m[1], loginUrl); if (u.origin === new URL(base).origin) input.allowLoginAction?.(u.toString(), false, passwordField); } catch { /* unsupported actions remain blocked */ }
    }
    const initialCookies = Object.fromEntries((await context.cookies()).map(c => [c.name, c.value]));
    const csrf = detectCsrf(html, initialCookies, observedHeaders);
    await context.setExtraHTTPHeaders(csrf.headers);
    await form.locator(usernameSelector).first().fill(input.username ?? input.email ?? "", { timeout: 2000 });
    await form.locator('input[type="password"]').first().fill(input.password, { timeout: 2000 });
    const responsePromise = page.waitForResponse(r => r.request().method() === "POST", { timeout: 6000 }).catch(() => null);
    await form.locator('button[type="submit"], input[type="submit"], button:not([type])').first().click({ timeout: 3000 });
    const response = await responsePromise;
    await page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {});
    const urls: string[] = [];
    const location = response ? (await response.allHeaders())["x-bughunter-redirect-location"] : undefined;
    if (location) {
      try { const u = new URL(location, loginUrl); assertExecutionUrl(u.toString()); if (isSafeReadUrl(u.toString())) { urls.push(u.toString()); await page.goto(u.toString(), { waitUntil: "domcontentloaded", timeout: 4000 }).catch(() => {}); } } catch { /* no foreign or action redirect */ }
    }
    const links = await page.locator("a[href]").evaluateAll(elements => elements.map(e => e.getAttribute("href") ?? "")).catch(() => []);
    for (const raw of [page.url(), ...links]) {
      try { const u = new URL(raw, base); assertExecutionUrl(u.toString()); if (isSafeReadUrl(u.toString())) urls.push(u.toString()); } catch { /* no scope expansion */ }
    }
    const rejected = Boolean(response && [400, 401, 403].includes(response.status()));
    if (!rejected) await page.locator('input[type="password"]').first().waitFor({ state: "hidden", timeout: 2500 }).catch(() => {});
    if ((await page.locator('input[autocomplete="one-time-code"], input[name="otp"], input[name="totp"]').count()) > 0) return { cookies: {}, error: "Additional sign-in step could not be verified" };
    if (rejected) return { cookies: {}, rejected: true, error: "Credentials rejected", csrfSources: csrf.sources };
    const raw = await context.cookies();
    const cookies = Object.fromEntries(raw.map(c => [c.name, c.value]));
    const expiries = raw.filter(c => c.expires > 0 && !/csrf|xsrf/i.test(c.name)).map(c => c.expires * 1000);
    return { cookies, bearerToken, loginUrl, candidateUrls: [...new Set(urls)].slice(0, 8), expiresAt: expiries.length ? new Date(Math.min(...expiries)) : undefined, csrfSources: csrf.sources };
  } catch { throwIfScanAborted(); return { cookies: {}, error: "Unable to establish a verified session" }; }
  finally { await context?.close().catch(() => {}); await browser?.close().catch(() => {}); }
}
