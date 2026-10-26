import assert from "node:assert/strict";
import { chromium } from "playwright-chromium";
import { PrismaClient } from "@prisma/client";
const app = process.env.TEST_APP_URL;
const database = process.env.TEST_DATABASE_URL;
assert(app && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(app), "Requires isolated local app");
assert(database && ["127.0.0.1", "localhost"].includes(new URL(database).hostname) && ["/hunt_clean", "/bughunter_blackbox_e2e"].includes(new URL(database).pathname), "Requires disposable Hunt database");
const prisma = new PrismaClient({ datasourceUrl: database });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const context = await browser.newContext(); const page = await context.newPage(); const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const email = `hunt-ui-${Date.now()}@example.test`; const password = "Isolated-Hunt-Test-123";
  assert.equal((await context.request.post(`${app}/api/register`, { data: { email, password, name: "Hunt UI" } })).status(), 201);
  await page.goto(`${app}/login`); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(password); await page.getByRole("button", { name: "Sign in", exact: true }).click(); await page.waitForURL(`${app}/targets`);
  const created = await context.request.post(`${app}/api/programs`, { data: { companyName: "Hunt Readiness Lab", requiredUserAgent: "Hunt-UI/1", scopeHosts: ["hunt-ui.example.test"], qualifying: ["XSS", "IDOR", "SQL_INJECTION", "JWT"], nonQualifying: [] } });
  assert.equal(created.status(), 201); const program = await created.json();
  const programs = await (await context.request.get(`${app}/api/programs`)).json(); const host = programs.find(p => p.id === program.id).targets[0];
  await page.goto(`${app}/targets/${program.id}`); await page.getByRole("heading", { name: "Hunt readiness", exact: true }).waitFor();
  await page.getByText("Missing authenticated session", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Configure authentication →", exact: true }).click(); await page.waitForURL(`${app}/hosts/${host.id}#authentication`);
  const secret = "NEVER-SHOW-THIS-COOKIE";
  const cred = await context.request.post(`${app}/api/targets/${host.id}/credentials`, { data: { label: "Account A", purpose: "ACCOUNT_A", mode: "COOKIES", cookies: { session: secret } } }); assert.equal(cred.status(), 201);
  const readiness = await (await context.request.get(`${app}/api/targets/${host.id}/hunt-readiness`)).text(); assert(!readiness.includes(secret));
  await page.goto(`${app}/hunt?program=${program.id}`); await page.getByText("Missing authenticated session", { exact: true }).waitFor(); assert(!(await page.locator("body").innerText()).includes(secret));
  await page.getByText("Optional bounded timing tests — explicit approval", { exact: true }).click();
  const approval = page.getByRole("checkbox", { name: /I explicitly approve bounded SQL Injection/ }); assert.equal(await approval.isChecked(), false);
  await approval.check();
  const responsePromise = page.waitForResponse(r => r.url().endsWith("/api/scan-runs") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Start Hunt", exact: true }).click(); const response = await responsePromise; assert.equal(response.status(), 201); const run = await response.json();
  assert.deepEqual(run.approvedHuntTechniques, ["sqli.timing-screen", "sqli.timing-confirm"]);
  await page.waitForURL(`${app}/hunt/${run.id}`); await page.getByText(/Waiting for the scan worker/).waitFor();
  const report = { version: 1, startedAt: new Date().toISOString(), status: "COMPLETED", requests: 2, limits: { maxTotalRequests: 100 }, families: [
    { family: "xss", displayName: "XSS", selected: true, selectionReason: "QUALIFYING_SELECTED", readiness: "READY", state: "COMPLETED", completedTechniques: 2, applicableTechniques: 2, requests: 2, reason: "Completed safe tests" },
    { family: "bola", displayName: "IDOR / BOLA account comparison", selected: true, selectionReason: "QUALIFYING_SELECTED", readiness: "BLOCKED", state: "BLOCKED", completedTechniques: 0, applicableTechniques: 0, requests: 0, reason: "Needs second independent account" }
  ], techniques: [], candidates: [{ id: "signal", techniqueId: "xss.dom-inventory", family: "xss", title: "DOM sink observed", summary: "No controllable source demonstrated", evidenceLevel: "SIGNAL", controls: [], prerequisitesUsed: [], referenceIds: [] }, { id: "candidate", techniqueId: "sqli.timing-screen", family: "sqli", title: "Timing requires confirmation", summary: "Not confirmed", evidenceLevel: "CANDIDATE", controls: [], prerequisitesUsed: [], referenceIds: [] }] };
  // UI fixture only: no worker and no outbound target traffic.
  await prisma.scanRun.update({ where: { id: run.id }, data: { status: "COMPLETED", huntReport: report } });
  await page.getByText("Signal · DOM sink observed", { exact: true }).waitFor(); await page.getByText("Candidate · Timing requires confirmation", { exact: true }).waitFor(); await page.locator(".ui-card").filter({ has: page.getByRole("heading", { name: "IDOR / BOLA account comparison", exact: true }) }).getByText("Advanced techniques", { exact: true }).click(); await page.getByText("Needs second independent account", { exact: true }).waitFor();
  assert.equal(await page.getByText("Confirmed finding", { exact: true }).count(), 0);
  await page.setViewportSize({ width: 390, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "/tmp/bughunter-hunt-workflow-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  const other = await browser.newContext(); const denied = await other.request.get(`${app}/api/scan-runs/${run.id}/hunt`, { maxRedirects: 0 }); assert.equal(denied.status(), 307); assert(new URL(denied.headers().location, app).pathname === "/login"); await other.close();
  console.log("Hunt browser workflow passed: preflight readiness, credential actions, secret-free metadata, default-off explicit approval, queued progress, polling, blocked reasons, evidence levels and mobile layout.");
} finally { await browser.close(); await prisma.$disconnect(); }
