import assert from "node:assert/strict";
import { chromium } from "playwright-chromium";
import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const app = process.env.TEST_APP_URL ?? "http://localhost:3000";
assert(/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(app));
if (!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD) { console.error("E2E_AUTH_UNAVAILABLE: E2E_EMAIL and E2E_PASSWORD are required."); process.exit(2); }
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const results = [], events = [];
const record = (feature, scenario, result, notes = "") => { results.push({ feature, scenario, result, notes }); console.log(`${result}: ${feature} / ${scenario}${notes ? ` — ${notes}` : ""}`); };
const context = await browser.newContext(); const page = await context.newPage();
const paths = [];
page.on("pageerror", () => events.push({ kind: "pageerror", path: new URL(page.url()).pathname }));
page.on("console", msg => { if (["warning", "error"].includes(msg.type())) events.push({ kind: msg.type(), path: new URL(page.url()).pathname }); });
page.on("response", r => { if (r.status() >= 400) events.push({ kind: "http", status: r.status(), path: new URL(r.url()).pathname }); });
const company = `E2E Deep Audit Target ${Date.now()}`;
const ua = `E2E-Deep-Audit/${Date.now()}`; let programId, host;
async function check(condition, feature, scenario, notes = "") { record(feature, scenario, condition ? "PASS" : "FAIL", notes); }
async function json(url, options) { const r = await context.request.fetch(app + url, options); return { status: r.status(), body: await r.json() }; }
async function screen(route) {
  await page.goto(app + route); await page.waitForLoadState("networkidle"); await page.reload(); await page.waitForLoadState("networkidle");
  for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) { await page.setViewportSize(size); await check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Responsive", `${route.replaceAll(programId ?? "", "PROGRAM")} ${size.width}`); }
  paths.push(route);
}
async function editPolicy(qualifying, nonQualifying = []) { const r = await json(`/api/programs/${programId}`, { method: "PATCH", data: { qualifying, nonQualifying } }); assert.equal(r.status, 200); }
async function waitRun(runId) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) { const r = await json(`/api/scan-runs?targetId=${host.id}`); const run = r.body.find(r => r.id === runId); if (["COMPLETED", "FAILED"].includes(run?.status)) return run; await new Promise(r => setTimeout(r, 750)); }
  throw new Error("Local fixture scan did not finish within 180 seconds");
}
try {
  await page.goto(`${app}/login`); await page.getByLabel("Email", { exact: true }).fill(process.env.E2E_EMAIL); await page.getByLabel("Password", { exact: true }).fill(process.env.E2E_PASSWORD); await page.getByRole("button", { name: "Sign in", exact: true }).click(); await page.waitForURL(`${app}/targets`);
  await page.getByRole("button", { name: "Create Target", exact: true }).click();
  assert.equal(await page.locator("form").evaluate(f => f.checkValidity()), false);
  await page.getByLabel("Company / Program name *", { exact: true }).fill(company);
  assert.equal(await page.locator("form").evaluate(f => f.checkValidity()), false);
  await page.getByLabel(/^Required User-Agent/).fill(ua); await page.getByLabel("Platform", { exact: true }).selectOption("PRIVATE");
  for (const [label, value] of Object.entries({ Low: "10.10", Medium: "100.20", High: "1000.30", Critical: "10000.40" })) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel("Currency", { exact: true }).fill("EUR");
  const scope = page.getByRole("group", { name: "Scope", exact: true }); await scope.getByRole("button", { name: "+ Add host", exact: true }).click(); await page.getByLabel("Scope FQDN 1", { exact: true }).fill("E2E-DEEP-AUDIT.TEST.");
  const qualifying = page.getByRole("group", { name: /^Qualifying vulnerabilities/ });
  for (const label of ["XSS", "IDOR", "JWT", "OAUTH", "XXE", "SSTI"]) { const c = qualifying.getByLabel(label, { exact: true }); if (await c.count()) await c.check(); }
  await page.getByRole("button", { name: "Create Target", exact: true }).click(); await page.waitForURL(/\/targets\/[^/]+$/); programId = new URL(page.url()).pathname.split("/").at(-1); await page.getByRole("heading", { name: company, exact: true }).waitFor();
  const p = await json(`/api/programs/${programId}`); host = p.body.targets.find(h => h.host === "e2e-deep-audit.test"); assert(host);
  record("Targets", "create through UI / required company and UA / rewards / normalized host", "PASS");
  // Fixture setup only: new Scope UI stores FQDNs without an HTTP scheme selector.
  // Set HTTP on this audit-created identity so no production TLS trust is weakened.
  const setup = 'const {PrismaClient}=require("@prisma/client");const p=new PrismaClient();(async()=>{const h=await p.target.findUnique({where:{id:process.argv[1]},include:{program:true}});if(!h||h.host!=="e2e-deep-audit.test"||!h.program.companyName.startsWith("E2E Deep Audit Target "))throw Error("Not an audit fixture");await p.target.update({where:{id:h.id},data:{scheme:"http"}});await p.$disconnect()})().catch(()=>process.exit(1))';
  execFileSync("docker", ["compose", "exec", "-T", "web", "node", "-e", setup, host.id], { stdio: "pipe" });
  await screen(`/targets/${programId}`);
  await page.getByRole("button", { name: "Edit Target", exact: true }).click(); await page.getByLabel("Company / Program name *", { exact: true }).fill(company + " edited"); await page.getByLabel("Low", { exact: true }).fill("11.11");
  await page.getByRole("button", { name: /Save Target/ }).click(); await page.getByRole("heading", { name: company + " edited", exact: true }).waitFor(); await page.reload();
  const edited = await json(`/api/programs/${programId}`); assert.equal(edited.body.rewardLow, "11.11"); record("Targets", "edit and refresh persistence", "PASS");
  await screen(`/scopes/${programId}`);
  const addHost = async value => { await page.getByRole("button", { name: "+ Add host", exact: true }).click(); await page.getByRole("textbox", { name: "FQDN", exact: true }).fill(value); await page.getByRole("button", { name: "Save", exact: true }).click(); };
  await addHost("api.example.test"); await page.getByRole("button", { name: "Scope — 2 hosts", exact: true }).waitFor();
  await addHost("API.EXAMPLE.TEST."); await page.getByRole("alert").waitFor(); await page.getByRole("button", { name: "Cancel", exact: true }).click(); record("Scope", "case/trailing-dot duplicate rejected", "PASS");
  for (const invalid of ["https://api.example.test", "api.example.test/path", "invalid host", "a..example.test"]) { await addHost(invalid); await page.getByRole("alert").waitFor(); await page.getByRole("button", { name: "Cancel", exact: true }).click(); } record("Scope", "scheme/path/spaces/malformed rejected", "PASS");
  await addHost("*.example.test"); await page.getByRole("button", { name: "Scope — 3 hosts", exact: true }).waitFor(); await addHost("admin.example.test"); await page.getByRole("button", { name: "Scope — 4 hosts", exact: true }).waitFor();
  await page.getByRole("button", { name: "Out of scope — 0 hosts", exact: true }).click(); await addHost("admin.example.test"); await page.getByRole("button", { name: "Out of scope — 1 hosts", exact: true }).waitFor();
  const selectors = await json("/api/scan-hosts"); const selected = selectors.body.find(p => p.id === programId); assert(!selected.hosts.some(h => h.host === "admin.example.test" || h.host.includes("*"))); record("Scope", "explicit exclusion and wildcard selection restrictions", "PASS");
  const denied = await json("/api/programs/not-owned", { method: "PATCH", data: { companyName: "Never written" } }); assert.equal(denied.status, 404); record("Ownership", "arbitrary ID read/write rejected", "PASS");
  for (const route of ["/api/programs/not-owned", "/api/targets/not-owned", "/api/targets/not-owned/hunt-readiness", "/api/reports/not-owned"]) { const r = await context.request.get(app + route); await check(r.status() === 404, "Ownership", route); }
  // Fake target-session material, unrelated to the BugHunter login; never persisted in test output.
  for (const role of ["ACCOUNT_A", "ACCOUNT_B"]) {
    const secret = randomUUID(); const r = await json(`/api/targets/${host.id}/credentials`, { method: "POST", data: { label: `E2E ${role}`, purpose: role, mode: "COOKIES", cookies: { session: secret }, ...(role === "ACCOUNT_B" ? { ownedObjectUrl: "http://e2e-deep-audit.test/api/objects/123" } : {}) } }); assert.equal(r.status, 201); assert(!JSON.stringify(r.body).includes(secret));
  }
  const ready = await json(`/api/targets/${host.id}/hunt-readiness`); await check(ready.body.families?.find(f => f.family === "bola")?.state === "DEGRADED" || ready.body.families?.find(f => f.family === "bola")?.state === "READY", "Credentials", "two-account readiness", "owned-object attestation configured");
  await screen(`/hosts/${host.id}`); await page.getByText("Advanced — host credentials", { exact: true }).click(); await page.getByText("E2E ACCOUNT_A", { exact: false }).first().waitFor(); record("Credentials", "safe metadata after refresh", "PASS");
  await page.goto(`${app}/recon?program=${programId}`); await page.getByLabel("Company", { exact: true }).selectOption(programId); await page.getByLabel("Host", { exact: true }).selectOption(host.id);
  const reconResponse = page.waitForResponse(r => r.url().endsWith("/api/scan-runs") && r.request().method() === "POST"); await page.getByRole("button", { name: "Start Recon", exact: true }).click(); const recon = await (await reconResponse).json(); await page.waitForURL(`${app}/hosts/${host.id}`); await page.reload(); const reconResult = await waitRun(recon.id); record("Recon", "new local fixture run and refresh", reconResult.status === "COMPLETED" ? "PASS" : "FAIL");
  for (const [qualifying, excluded] of [[["XSS", "IDOR", "SSTI", "JWT", "OAUTH", "XXE"], []], [[], []], [[], ["XSS", "CSRF", "RCE", "SSRF"]]]) {
    await editPolicy(qualifying, excluded); await page.goto(`${app}/hunt?program=${programId}`); await page.getByLabel("Company", { exact: true }).selectOption(programId); await page.getByLabel("Host", { exact: true }).selectOption(host.id);
    const response = page.waitForResponse(r => r.url().endsWith("/api/scan-runs") && r.request().method() === "POST"); await page.getByRole("button", { name: "Start Hunt", exact: true }).click(); const run = await (await response).json(); await page.waitForURL(`${app}/hunt/${run.id}`); await page.reload(); const final = await waitRun(run.id); const detail = await json(`/api/scan-runs/${run.id}/hunt`);
    await check(final.status === "COMPLETED", "Hunt", `policy ${qualifying.length ? "subset" : "empty"} excluded=${excluded.length}`);
    assert(detail.body.huntSnapshot); assert(detail.body.huntReport.requests <= 100); assert(detail.body.huntReport.techniques.filter(t => ["RUNNING", "COMPLETED"].includes(t.state)).every(t => detail.body.huntSnapshot.selectedFamilies.includes(t.family)));
    assert(!detail.body.huntReport.candidates.some(c => c.title.includes("DOM") && c.evidenceLevel === "CONFIRMED")); assert(!detail.body.huntReport.candidates.some(c => /SSTI/.test(c.title) && c.evidenceLevel === "CONFIRMED"));
    record("Hunt", "snapshot, bounded techniques, literal/DOM false-positive controls", "PASS");
  }
  const capture = await (await fetch("http://127.0.0.1:55447/__audit/summary")).json(); const targetRequests = capture.requests.filter(r => r.ua && /E2E-Deep-Audit\//.test(r.ua)); assert(targetRequests.length > 0); assert(targetRequests.every(r => r.ua === ua && r.host === "e2e-deep-audit.test")); assert(!capture.requests.some(r => r.host === "e2e-foreign-audit.test")); record("HTTP", "actual Recon/Hunt User-Agent capture and foreign redirect", "PASS", `${targetRequests.length} requests with required UA; no foreign host request`);
  await screen(`/targets/${host.id}/findings`); await page.getByPlaceholder("Title", { exact: true }).fill("E2E Deep Audit Signal"); await page.getByRole("button", { name: "Add finding", exact: true }).click(); await page.getByText("E2E Deep Audit Signal", { exact: true }).waitFor(); await page.reload(); await page.getByText("E2E Deep Audit Signal", { exact: true }).waitFor(); record("Findings", "manual signal create and persistence", "PASS");
  const findings = await json(`/api/findings?targetId=${host.id}`); const finding = findings.body.find(f => f.title === "E2E Deep Audit Signal"); assert(finding); const rejectedReport = await json("/api/reports", { method: "POST", data: { title: "E2E must reject", platform: "GENERIC", findingIds: [finding.id] } }); assert.equal(rejectedReport.status, 400); record("Reports", "unvalidated finding rejected", "PASS");
  await screen(`/targets/${host.id}/report`); await check(await page.getByRole("button", { name: "Generate report", exact: true }).isDisabled(), "Reports", "no passed findings disables generation");
  const all = await json(`/api/programs/${programId}/hosts`); const disposable = all.body.find(h => h.host === "api.example.test"); assert(disposable); const removed = await json(`/api/programs/${programId}/hosts/${disposable.id}`, { method: "DELETE" }); assert.equal(removed.status, 200); const refused = await json("/api/scan-runs", { method: "POST", data: { targetId: disposable.id, type: "RECON" } }); assert.equal(refused.status, 400); record("Scope", "removed host rejected for new scans", "PASS");
  const readded = await json(`/api/programs/${programId}/hosts`, { method: "POST", data: { host: "api.example.test" } }); assert.equal(readded.status, 201); record("Scope", "re-add removed host", "PASS");
  await writeFile("/tmp/deep-audit-objects.json", JSON.stringify({ programId, hostId: host.id, company, ua, paths }));
} catch (e) { record("Workflow", "execution", "FAIL", `${e.name}: ${String(e.message).replaceAll(process.env.E2E_PASSWORD, "[REDACTED]").replaceAll(process.env.E2E_EMAIL, "[ACCOUNT]").slice(0, 750)}`); process.exitCode = 1; }
finally { await writeFile("/tmp/deep-e2e-workflow.json", JSON.stringify({ browser: browser.version(), programId, hostId: host?.id, company, ua, results, events }, null, 2)); await browser.close(); }
