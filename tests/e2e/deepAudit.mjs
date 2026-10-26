import assert from "node:assert/strict";
import { chromium } from "playwright-chromium";
import { writeFile } from "node:fs/promises";
const app = process.env.TEST_APP_URL ?? "http://127.0.0.1:3000";
assert(/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(app), "Use an explicitly local app URL");
if (!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD) { console.error("E2E_AUTH_UNAVAILABLE: E2E_EMAIL and E2E_PASSWORD are required; authentication was not attempted."); process.exit(2); }
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const results = []; const events = [];
const record = (feature, scenario, result, notes = "") => { results.push({ feature, scenario, result, notes }); console.log(`${result}: ${feature} / ${scenario}${notes ? ` — ${notes}` : ""}`); };
const safePath = url => { try { return new URL(url).pathname; } catch { return "invalid-url"; } };
const context = await browser.newContext();
// Capture categories/paths only: console text, bodies, request headers and cookies can contain secrets.
context.on("page", page => {
  page.on("pageerror", () => events.push({ kind: "pageerror", path: safePath(page.url()) }));
  page.on("console", msg => { if (["error", "warning"].includes(msg.type())) events.push({ kind: `console-${msg.type()}`, path: safePath(page.url()) }); });
  page.on("response", r => { if (r.status() >= 400) events.push({ kind: "http", status: r.status(), path: safePath(r.url()) }); });
});
const page = await context.newPage();
async function login(p = page) {
  await p.goto(`${app}/login`); await p.getByLabel("Email", { exact: true }).fill(process.env.E2E_EMAIL);
  await p.getByLabel("Password", { exact: true }).fill(process.env.E2E_PASSWORD);
  await p.getByRole("button", { name: "Sign in", exact: true }).click();
  await p.waitForURL(`${app}/targets`, { timeout: 20000 });
}
try {
  for (const route of ["/dashboard", "/targets", "/scopes", "/recon", "/hunt", "/findings", "/reports", "/settings", "/hosts/missing", "/targets/missing", "/scopes/missing", "/hunt/missing"]) {
    await page.goto(app + route); assert.equal(safePath(page.url()), "/login"); assert.equal(new URL(page.url()).searchParams.get("callbackUrl"), route);
    await page.reload(); assert.equal(safePath(page.url()), "/login"); record("Anonymous", route, "PASS", "login redirect and refresh");
  }
  for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size); await page.goto(`${app}/login`); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await page.getByLabel("Password", { exact: true }).getAttribute("type"), "password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click(); assert.equal(await page.locator("form").evaluate(f => f.checkValidity()), false);
    await page.getByRole("link", { name: "Create one", exact: true }).click(); await page.waitForURL(`${app}/register`); assert.equal(safePath(page.url()), "/register"); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.goBack(); await page.waitForURL(`${app}/login`); await page.goForward(); await page.waitForURL(`${app}/register`); await page.reload(); await page.getByRole("link", { name: "Sign in", exact: true }).click(); await page.waitForURL(`${app}/login`);
    record("Public forms", `${size.width}x${size.height}`, "PASS", "labels, empty validation, history, refresh, no overflow");
  }
  await page.setViewportSize({ width: 1366, height: 768 }); await login(); record("Authentication", "provided E2E credentials", "PASS");
  const cookies = await context.cookies(app); const session = cookies.find(c => c.name.includes("session-token")); assert(session); assert(session.httpOnly); assert.equal(session.sameSite, "Lax"); record("Authentication", "session cookie attributes", "PASS", `HTTP-only; SameSite=Lax; Secure=${session.secure} on local HTTP`);
  for (const route of ["/targets", "/scopes", "/recon", "/hunt", "/settings"]) {
    await page.goto(app + route); await page.getByRole("navigation").waitFor();
    await page.reload(); await page.getByRole("navigation").waitFor();
    for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) { await page.setViewportSize(size); if (!await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) record("Responsive", `${route} ${size.width}`, "FAIL", "horizontal overflow"); }
    record("Navigation", route, "PASS", "direct URL, refresh, three viewport widths");
  }
  for (const label of ["Targets", "Scopes", "Recon", "Hunt", "Settings"]) { await page.getByRole("navigation").getByRole("link", { name: label, exact: true }).click(); await page.waitForURL(app + (label === "Targets" ? "/targets" : `/${label.toLowerCase()}`)); record("Menus", label, "PASS"); }
  for (const route of ["/dashboard", "/findings", "/reports"]) { const res = await page.goto(app + route); record("Legacy/global route", route, res.status() === 404 ? "NOT_TESTED" : "PASS", res.status() === 404 ? "No implemented global page; findings/reports currently accessed via host" : `HTTP ${res.status()}`); }
  const tab = await context.newPage(); await tab.goto(`${app}/targets`); await tab.getByRole("heading", { name: "Targets", exact: true }).waitFor();
  await page.goto(`${app}/targets`); await page.getByRole("button", { name: "Sign out", exact: true }).click(); await page.waitForURL(`${app}/login`);
  await tab.reload(); assert.equal(safePath(tab.url()), "/login"); await page.goto(`${app}/targets`); assert.equal(safePath(page.url()), "/login"); record("Authentication", "logout and second tab refresh", "PASS"); await tab.close();
} catch (e) { record("Audit", "execution", "FAIL", e instanceof assert.AssertionError ? "Assertion failed; inspect scenario" : `${e.name}: ${String(e.message).replaceAll(process.env.E2E_PASSWORD, "[REDACTED]").replaceAll(process.env.E2E_EMAIL, "[ACCOUNT]").slice(0, 700)}`); process.exitCode = 1; }
finally { await writeFile(process.env.AUDIT_RESULTS_PATH ?? "/tmp/deep-e2e-baseline.json", JSON.stringify({ browser: browser.version(), results, events }, null, 2)); await browser.close(); }
