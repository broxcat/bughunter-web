// Built app against the test runner's disposable Postgres/Redis only.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { chromium } from "playwright-chromium";
const exec = promisify(execFile);
const db = process.env.TEST_ABUSE_DATABASE_URL, redis = process.env.TEST_ABUSE_REDIS_URL, container = process.env.TEST_ABUSE_REDIS_CONTAINER;
assert(db && redis && container, "Use npm run test:queue -- --research-browser for disposable services");
assert.equal((await exec("docker", ["inspect", "--format", '{{index .Config.Labels "bughunter.queue-test"}}', container])).stdout.trim(), "disposable");
const server = createServer(); await new Promise(r => server.listen(0, "127.0.0.1", r));
const port = server.address().port; await new Promise(r => server.close(r));
const origin = `http://127.0.0.1:${port}`, root = await mkdtemp(join(tmpdir(), "research-browser-"));
const prisma = new PrismaClient({ datasourceUrl: db }), password = randomUUID();
let web, browser;
try {
  const user = await prisma.user.create({ data: { email: `research-${randomUUID()}@example.test`, passwordHash: await bcrypt.hash(password, 10) } });
  const env = { ...process.env, DATABASE_URL: db, REDIS_URL: redis, AUTH_URL: origin, AUTH_SECRET: randomUUID(), CREDENTIALS_ENCRYPTION_KEY: "ab".repeat(32), RESEARCH_WORKSPACE_ROOT: root, RESEARCH_WORKSPACE_GID: String(process.getgid()), ALLOW_PUBLIC_REGISTRATION: "false", TRUST_PROXY_HEADERS: "false", GITHUB_ID: "", GOOGLE_CLIENT_ID: "", LOG_LEVEL: "silent" };
  web = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { env, stdio: "ignore" });
  let ready = false;
  for (let n = 0; n < 100; n++) {
    if (web.exitCode !== null) throw new Error("Disposable web failed to start");
    try { if ((await fetch(origin + "/api/health")).ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  assert(ready);
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext(), page = await context.newPage();
  const pageErrors = []; page.on("pageerror", e => pageErrors.push(e.name));
  await page.goto(origin + "/login");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click(); await page.waitForURL(origin + "/targets");
  // Create an actual Target through the form, with an explicitly authorized .test host.
  await page.getByRole("button", { name: "Create Target", exact: true }).click();
  await page.getByLabel("Company / Program name *", { exact: true }).fill("Research browser fixture");
  await page.getByRole("textbox", { name: /^Required User-Agent/ }).fill("BrowserResearch/1");
  await page.getByRole("button", { name: "+ Add host", exact: true }).first().click();
  await page.getByLabel("Scope FQDN 1", { exact: true }).fill("app.example.test");
  const created = page.waitForResponse(r => new URL(r.url()).pathname === "/api/programs" && r.request().method() === "POST");
  await page.getByRole("button", { name: "Create Target", exact: true }).click();
  const program = await (await created).json();
  await page.waitForURL(origin + `/targets/${program.id}`);
  const target = await prisma.target.findFirstOrThrow({ where: { programId: program.id } });
  // Labelled synthetic Recon evidence; this test never contacts example.test.
  const recon = await prisma.scanRun.create({ data: { targetId: target.id, type: "RECON", status: "COMPLETED", reconCorpus: { version: 1, capturedAt: new Date().toISOString(), urls: ["https://app.example.test/search"], authenticated: false, surface: Object.fromEntries(["queryInputs", "objectReferences", "forms", "javascript", "cookies", "jwt", "oauth", "xml", "urlInputs", "fileInputs", "businessFlows", "apiEndpoints"].map(k => [k, false])) } } });
  await page.getByRole("navigation").getByRole("link", { name: "Research", exact: true }).click(); await page.waitForURL(origin + "/research");
  await page.getByLabel("Target", { exact: true }).selectOption(program.id);
  await page.getByLabel("Host", { exact: true }).selectOption(target.id);
  await page.getByText(new RegExp(`Recon source: ${recon.id}`)).waitFor();
  const response = page.waitForResponse(r => new URL(r.url()).pathname === "/api/research-sessions" && r.request().method() === "POST");
  await page.getByRole("button", { name: "Create Research Workspace", exact: true }).click();
  const research = await (await response).json(); assert.equal(research.status, "READY");
  await page.waitForURL(origin + `/research/${research.id}`);
  await page.getByText("Status: READY", { exact: true }).waitFor();
  assert((await page.locator("body").innerText()).includes("researcher@127.0.0.1"));
  assert((await readFile(join(root, research.workspaceId, "recon/endpoints.json"), "utf8")).includes(recon.id));
  const download = await context.request.get(origin + `/api/research-sessions/${research.id}/zip`); assert.equal(download.status(), 200); assert((await download.body()).byteLength > 100);
  await page.reload(); await page.getByText("Status: READY", { exact: true }).waitFor();
  assert.equal((await context.request.post(origin + "/api/scan-runs", { data: { targetId: target.id, type: "HUNT" } })).status(), 410);
  const old = await prisma.scanRun.create({ data: { targetId: target.id, type: "HUNT", status: "COMPLETED", huntReport: { version: 1, legacyEvidence: "Synthetic archived observation" } } });
  await page.goto(origin + `/hunt/${old.id}`); await page.getByText(/This scan was produced by the retired/).waitFor();
  assert.equal(await page.getByRole("button", { name: /Start Hunt|Run hunt/ }).count(), 0);
  const foreign = await browser.newContext();
  const anonymous = await foreign.request.get(origin + `/api/research-sessions/${research.id}/zip`, { maxRedirects: 0 });
  assert([307, 401].includes(anonymous.status())); assert.notEqual(anonymous.headers()["content-type"], "application/zip");
  await foreign.close();
  assert.deepEqual(pageErrors, []);
  console.log("Browser Research passed: Target creation, authorized host/Recon selection, workspace creation/detail/reload, ZIP download, retired Hunt API and read-only historical rendering.");
} finally {
  if (browser) await browser.close();
  if (web && web.exitCode === null) { const stopped = new Promise(r => web.once("exit", r)); web.kill("SIGTERM"); const timer = setTimeout(() => web.kill("SIGKILL"), 3000); await stopped; clearTimeout(timer); }
  await prisma.$disconnect(); await rm(root, { recursive: true, force: true });
}
