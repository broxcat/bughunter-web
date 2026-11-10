// Authenticated browser acceptance against disposable PostgreSQL/Redis only.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright-chromium';
import bcrypt from 'bcryptjs';
const db = process.env.TEST_DATABASE_URL;
assert(db && process.env.TEST_EXECUTION_REDIS_URL, 'Disposable TEST_DATABASE_URL and TEST_EXECUTION_REDIS_URL required');
const url = new URL(db); url.searchParams.set('schema', 'deletion_browser_' + randomUUID().replaceAll('-', ''));
const databaseUrl = url.href;
const root = await mkdtemp(join(tmpdir(), 'deletion-browser-'));
const portServer = createServer(); await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve));
const origin = 'http://127.0.0.1:' + port;
const env = { ...process.env, DATABASE_URL: databaseUrl, REDIS_URL: process.env.TEST_EXECUTION_REDIS_URL,
  AUTH_URL: origin, AUTH_SECRET: randomUUID(), LOG_LEVEL: 'silent', CREDENTIALS_ENCRYPTION_KEY: 'ab'.repeat(32),
  RESEARCH_CONSOLE_ROOT: join(root, 'consoles'), RESEARCH_WORKSPACE_ROOT: join(root, 'workspaces'),
  RESEARCH_TERMINAL_CONTROL_URL: 'http://127.0.0.1:1', RESEARCH_TERMINAL_PRIVATE_KEY_FILE: join(root, 'private.pem') };
await writeFile(env.RESEARCH_TERMINAL_PRIVATE_KEY_FILE, generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
const appDir = process.env.TARGET_DELETION_APP_DIR ?? process.cwd();
const baseline = process.env.DELETION_BASELINE === '1';
execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: appDir, env, stdio: 'pipe' });
const p = new PrismaClient({ datasourceUrl: databaseUrl });
let web, browser, worker;
const logs = [];
async function until(check, limit = 30000) {
  const deadline = Date.now() + limit;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw Error('Browser fixture timed out');
}
try {
  const password = randomUUID();
  const user = await p.user.create({ data: { email: randomUUID() + '@example.test', passwordHash: await bcrypt.hash(password, 10) } });
  const policy = { automationAllowed: true, requiredUserAgent: 'DeletionBrowser/1', requiredHeaders: [], exclusions: [],
    requestsPerSecond: 5, maxConcurrency: 2, forbiddenCategories: [], sourceSnapshot: { url: null, rules: '', unrepresentedRules: [] } };
  async function fixture(label, status = 'RUNNING') {
    const program = await p.bountyProgram.create({ data: { ownerId: user.id, companyName: label, requiredUserAgent: 'DeletionBrowser/1', executionPolicies: { create: { version: 1, policy } } } });
    const scope = await p.scope.create({ data: { userId: user.id, hostPattern: 'app.example.test', status: 'APPROVED' } });
    const asset = await p.scopeAsset.create({ data: { programId: program.id, originalValue: 'app.example.test', normalizedValue: 'app.example.test', format: 'SUBDOMAIN', type: 'WEB_APPLICATION' } });
    const target = await p.target.create({ data: { programId: program.id, userId: user.id, scopeId: scope.id, scopeAssetId: asset.id, host: 'app.example.test' } });
    const scan = await p.scanRun.create({ data: { targetId: target.id, scopeAssetId: asset.id, type: 'RECON', status } });
    await p.researchSession.create({ data: { userId: user.id, targetId: target.id, workspaceId: 'research_' + target.id, consoleTargetId: target.id,
      reconScanRunId: scan.id, targetHost: target.host, programName: label, status: 'READY', scopeMarkdown: 'Controlled fixture' } });
    return { program, target, scan };
  }
  const dead = await fixture('Offline console and dead worker');
  await p.scanExecutionAttempt.create({ data: { scanRunId: dead.scan.id, workerId: 'dead-browser-fixture', state: 'RUNNING' } });
  web = spawn(process.execPath, ['node_modules/next/dist/bin/next', process.env.TARGET_DELETION_DEV === '1' ? 'dev' : 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: appDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [web.stdout, web.stderr]) stream.on('data', chunk => logs.push(String(chunk)));
  await until(async () => { if (web.exitCode !== null) throw Error(logs.join('')); try { return (await fetch(origin + '/api/health')).ok; } catch { return false; } }, 60000);
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext(); const page = await context.newPage();
  await page.goto(origin + '/login');
  await page.getByLabel('Email', { exact: true }).fill(user.email); await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.waitForURL(origin + '/targets');
  async function dialog(fixture) {
    await page.goto(origin + '/targets/' + fixture.program.id + '/settings');
    await page.locator('summary').filter({ hasText: /^Delete target$/ }).click();
    await page.getByRole('button', { name: 'Delete target', exact: true }).click();
  }
  await dialog(dead);
  if (baseline) {
    const response = page.waitForResponse(r => r.request().method() === 'DELETE');
    await page.getByRole('button', { name: 'Confirm deletion' }).click();
    const r = await response;
    console.log('BASELINE UI HTTP:', r.status(), await r.text());
    await page.getByRole('alert').filter({ hasText: 'Deletion incomplete; target remains blocked. Retry deletion.' }).waitFor();
    console.log('BASELINE UI visible error:', await page.getByRole('alert').filter({ hasText: 'Deletion incomplete' }).innerText());
    assert.equal(r.status(), 503);
  } else {
    // Non-JSON reverse proxy errors remain readable and retryable.
    const endpoint = '**/api/programs/' + dead.program.id;
    await page.route(endpoint, route => route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>Bad gateway</h1>' }));
    await page.getByRole('button', { name: 'Confirm deletion' }).click();
    await page.getByRole('alert').filter({ hasText: 'Deletion failed (HTTP 502). Please retry.' }).waitFor();
    await page.unroute(endpoint);
    const start = Date.now();
    await page.getByRole('button', { name: 'Confirm deletion' }).click(); await page.waitForURL(origin + '/targets');
    assert(Date.now() - start < 5000); assert.equal(await p.bountyProgram.count({ where: { id: dead.program.id } }), 0);
    const active = await fixture('Active scan', 'QUEUED');
    const messages = [];
    worker = spawn(process.execPath, ['--import', 'tsx', 'tests/e2e/targetDeletionWorker.mts'], { env: { ...env, DELETION_TEST_JOB: JSON.stringify({ scanRunId: active.scan.id, targetId: active.target.id, type: 'RECON' }) }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    worker.on('message', message => messages.push(message)); worker.stdout.resume(); worker.stderr.on('data', chunk => logs.push(String(chunk)));
    await until(() => { if (worker.exitCode !== null) throw Error(logs.join('')); return messages.includes('started'); });
    await dialog(active); await page.getByRole('button', { name: 'Confirm deletion' }).click(); await page.waitForURL(origin + '/targets');
    await until(() => messages.includes('stopped'));
    assert(messages.includes('cleaned')); assert.equal(await p.scanRun.count({ where: { id: active.scan.id } }), 0);
    const denied = await fixture('French automation prohibition');
    const phrase = "L'utilisation d'outils automatisés est interdite";
    await p.programExecutionPolicy.create({ data: { programId: denied.program.id, version: 2,
      policy: { ...policy, automationAllowed: false, automationProhibition: phrase, sourceSnapshot: { url: null, rules: phrase, unrepresentedRules: [] } } } });
    await page.goto(origin + '/targets/' + denied.program.id);
    await page.getByText('The program policy does not allow automation. Program rule: ' + phrase, { exact: true }).waitFor();
    const decisionResponse = page.waitForResponse(r => r.url().endsWith('/automation-decision') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Not a testing ban', exact: true }).click();
    assert.equal((await decisionResponse).status(), 200);
    await page.getByText('The program policy does not allow automation. Program rule: ' + phrase, { exact: true }).waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('button', { name: 'Not a testing ban', exact: true }).count(), 0);
    const dismissed = await p.programExecutionPolicy.findFirstOrThrow({ where: { programId: denied.program.id }, orderBy: { version: 'desc' } });
    assert.equal(dismissed.version, 3); assert.equal(dismissed.policy.automationDecisions[0].phrase, phrase);
    assert.equal(dismissed.policy.automationAllowed, true);
    await p.bountyProgram.update({ where: { id: denied.program.id }, data: { rulesOfEngagement: "Don't use automated tools" } });
    await page.reload();
    await page.getByText("The program policy does not allow automation. Program rule: Don't use automated tools", { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Not a testing ban', exact: true }).waitFor();
    console.log('TARGET_DELETION_BROWSER: non-JSON error, /targets redirect, offline console, dead RUNNING worker active scan cleanup French evidence, one-click phrase decision and reblocking after changed rules passed');
  }
} catch (error) { console.error(logs.slice(-25).join('')); throw error; }
finally {
  await browser?.close(); web?.kill('SIGTERM'); worker?.kill('SIGTERM');
  if (web && web.exitCode === null) await new Promise(resolve => { web.once('exit', resolve); setTimeout(() => { web.kill('SIGKILL'); resolve(); }, 5000).unref(); });
  await p.$executeRawUnsafe(`DROP SCHEMA "${url.searchParams.get('schema')}" CASCADE`); await p.$disconnect();
  await rm(root, { recursive: true, force: true });
}
