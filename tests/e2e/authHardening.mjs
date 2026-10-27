// Invoked by test:auth with the runner's disposable services. No scan worker or
// external target is started; the only scan remains in the durable outbox.
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright-chromium";
const exec = promisify(execFile);
const databaseUrl = process.env.TEST_ABUSE_DATABASE_URL, redisUrl = process.env.TEST_ABUSE_REDIS_URL, redisContainer = process.env.TEST_ABUSE_REDIS_CONTAINER;
assert(databaseUrl && redisUrl && redisContainer, "Use npm run test:auth for isolated services");
assert.equal((await exec("docker", ["inspect", "--format", '{{index .Config.Labels "bughunter.queue-test"}}', redisContainer])).stdout.trim(), "disposable");
const portServer = createServer();
await new Promise(resolve => portServer.listen(0, "127.0.0.1", resolve));
const port = portServer.address().port;
await new Promise(resolve => portServer.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const email = `${randomUUID()}@auth-browser.example.test`, password = randomUUID();
const env = { ...process.env, DATABASE_URL: databaseUrl, REDIS_URL: redisUrl, AUTH_URL: origin, AUTH_SECRET: randomUUID(), CREDENTIALS_ENCRYPTION_KEY: "ab".repeat(32), GITHUB_ID: "", GOOGLE_CLIENT_ID: "", TRUST_PROXY_HEADERS: "false", LOG_LEVEL: "silent" };
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
let web, browser, redisStopped = false;
async function stopWeb() {
  if (!web || web.exitCode !== null || web.signalCode !== null) return;
  const stopped = new Promise(resolve => web.once("exit", resolve));
  web.kill("SIGTERM");
  const timer = setTimeout(() => web.kill("SIGKILL"), 3000);
  await stopped; clearTimeout(timer);
}
async function startWeb(registration) {
  await stopWeb();
  web = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { env: { ...env, ALLOW_PUBLIC_REGISTRATION: String(registration) }, stdio: "ignore" });
  for (let n = 0; n < 100; n++) {
    if (web.exitCode !== null) throw new Error("Disposable web server failed to start");
    try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Disposable web readiness timed out");
}
async function login(page, address = email, secret = password) {
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email", { exact: true }).fill(address);
  await page.getByLabel("Password", { exact: true }).fill(secret);
  const response = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/callback/credentials");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  return response;
}
try {
  // Bootstrap through the actual operator command; secrets only enter stdin.
  const bootstrap = spawn(process.execPath, ["scripts/create-user.mjs", email.toUpperCase(), "Auth browser fixture"], { env, stdio: ["pipe", "ignore", "ignore"] });
  bootstrap.stdin.end(password);
  assert.equal(await new Promise(resolve => bootstrap.once("exit", resolve)), 0);
  const owner = await prisma.user.findUniqueOrThrow({ where: { email } });
  const program = await prisma.bountyProgram.create({ data: { ownerId: owner.id, companyName: "Local auth browser fixture", requiredUserAgent: "AuthTest/1" } });
  const scope = await prisma.scope.create({ data: { userId: owner.id, hostPattern: "auth-browser.example.test", status: "APPROVED" } });
  const target = await prisma.target.create({ data: { userId: owner.id, programId: program.id, scopeId: scope.id, host: "auth-browser.example.test" } });
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext(), page = await context.newPage();
  await startWeb(false);
  await page.goto(`${origin}/login`); assert.equal(await page.getByRole("link", { name: "Create one" }).count(), 0);
  await page.goto(`${origin}/register`); await page.getByRole("heading", { name: "Public registration is disabled" }).waitFor();
  assert.equal((await context.request.post(`${origin}/api/register`, { data: { email, name: "Fixture", password } })).status(), 403);
  assert.equal((await login(page)).status(), 200); await page.waitForURL(`${origin}/targets`);
  console.log("PASS: private registration policy, operator bootstrap and existing-account login");

  const attackContext = await browser.newContext(), attackPage = await attackContext.newPage();
  for (let n = 0; n < 8; n++) {
    await attackContext.setExtraHTTPHeaders({ "x-forwarded-for": `203.0.113.${n + 1}`, "x-real-ip": `198.51.100.${n + 1}` });
    const response = await login(attackPage, email, "incorrect-password");
    if (n === 7) { assert.equal(response.status(), 429); await attackPage.getByRole("alert").filter({ hasText: "Too many sign-in attempts" }).waitFor(); }
    else { assert.equal(response.status(), 200); await attackPage.getByRole("alert").filter({ hasText: "Invalid email or password" }).waitFor(); }
  }
  console.log("PASS: forged IP headers cannot bypass account quota; real 429 reaches the form");

  await startWeb(true);
  const signupContext = await browser.newContext(), signup = await signupContext.newPage();
  const newEmail = `${randomUUID()}@auth-browser.example.test`;
  const confirmation = "If this address can be registered, your account is ready. Please sign in.";
  for (const address of [newEmail, email]) {
    await signup.goto(`${origin}/register`);
    await signup.getByLabel("Name", { exact: true }).fill("Public fixture");
    await signup.getByLabel("Email", { exact: true }).fill(address);
    await signup.getByLabel("Password", { exact: false }).fill(password);
    await signup.getByRole("button", { name: "Create account", exact: true }).click();
    await signup.getByRole("status").waitFor(); assert.equal(await signup.getByRole("status").textContent(), confirmation);
    assert.equal((await (await signupContext.request.get(`${origin}/api/auth/session`)).json()), null);
  }
  assert.equal((await login(signup, newEmail)).status(), 200); await signup.waitForURL(`${origin}/targets`);
  console.log("PASS: new/duplicate registration share one confirmation and require explicit sign-in");

  await exec("docker", ["stop", "-t", "0", redisContainer], { timeout: 20_000 }); redisStopped = true;
  assert.equal((await login(attackPage, email)).status(), 503);
  await attackPage.getByRole("alert").filter({ hasText: "Authentication temporarily unavailable" }).waitFor();
  assert.equal((await signupContext.request.post(`${origin}/api/register`, { data: { email: `${randomUUID()}@example.test`, name: "Fixture", password } })).status(), 503);
  const start = Date.now();
  const response = await context.request.post(`${origin}/api/scan-runs`, { headers: { "Idempotency-Key": "auth-browser-outage" }, data: { targetId: target.id, type: "RECON" } });
  assert.equal(response.status(), 202); assert(Date.now() - start < 5000);
  const run = await response.json(); assert.equal(run.status, "QUEUED"); assert.equal(run.outcome, null); assert.equal(run.dispatch, "PENDING");
  assert.equal((await prisma.scanJobOutbox.findUniqueOrThrow({ where: { scanRunId: run.id } })).status, "PENDING");
  console.log("PASS: real Redis outage gives login/signup 503 and authenticated scan 202 with durable outbox");
} finally {
  await stopWeb(); if (browser) await browser.close(); await prisma.$disconnect();
  if (redisStopped) await exec("docker", ["start", redisContainer], { timeout: 20_000 });
}
