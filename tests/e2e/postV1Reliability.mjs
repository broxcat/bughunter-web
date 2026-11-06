// Built Next + disposable SQL/Redis; all Recon evidence is synthetic. No worker or inference.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright-chromium';
const exec = promisify(execFile), db = process.env.TEST_DATABASE_URL, redis = process.env.TEST_ABUSE_REDIS_URL, container = process.env.TEST_ABUSE_REDIS_CONTAINER;
assert(db && redis && container, 'Use tests/queue/runInfrastructure.mjs --post-v1-browser');
assert.equal((await exec('docker', ['inspect', '--format', '{{index .Config.Labels "bughunter.queue-test"}}', container])).stdout.trim(), 'disposable');
const listener = createServer(); await new Promise(r => listener.listen(0, '127.0.0.1', r)); const port = listener.address().port; await new Promise(r => listener.close(r));
const origin = `http://127.0.0.1:${port}`, schema = 'postv1_' + randomUUID().replaceAll('-', '');
const url = new URL(db); url.searchParams.set('schema', schema);
const env = { ...process.env, DATABASE_URL: url.toString(), REDIS_URL: redis, AUTH_URL: origin, AUTH_SECRET: randomUUID(), CREDENTIALS_ENCRYPTION_KEY: 'ab'.repeat(32), LOG_LEVEL: 'silent' };
const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
let web, browser, checks = 0;
const check = (name, work) => { work(); checks++; console.log(`PASS ${checks}: ${name}`); };
async function login(page, email, password) {
  await page.goto(origin + '/login'); await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.waitForURL(origin + '/targets');
}
try {
  await exec('npx', ['prisma', 'migrate', 'deploy'], { env });
  const password = randomUUID();
  const owner = await prisma.user.create({ data: { email: randomUUID() + '@example.test', passwordHash: await bcrypt.hash(password, 10) } });
  const outsider = await prisma.user.create({ data: { email: randomUUID() + '@example.test', passwordHash: await bcrypt.hash(password, 10) } });
  const program = await prisma.bountyProgram.create({ data: { ownerId: owner.id, companyName: 'Reliability fixture', requiredUserAgent: 'Current-UA', scopeRules: ['fixture.test'] } });
  const scope = await prisma.scope.create({ data: { userId: owner.id, hostPattern: 'fixture.test', status: 'APPROVED' } });
  const asset = await prisma.scopeAsset.create({ data: { programId: program.id, originalValue: 'fixture.test', normalizedValue: 'fixture.test', format: 'DOMAIN', type: 'WEB_APPLICATION' } });
  const target = await prisma.target.create({ data: { userId: owner.id, scopeId: scope.id, programId: program.id, scopeAssetId: asset.id, host: 'fixture.test' } });
  const parent = await prisma.targetReconRun.create({ data: { programId: program.id, status: 'COMPLETED', outcome: 'PARTIAL' } });
  const scan = await prisma.scanRun.create({ data: { type: 'RECON', targetId: target.id, scopeAssetId: asset.id, targetReconRunId: parent.id, status: 'COMPLETED', outcome: 'PARTIAL', requiredUserAgent: 'Captured-UA', scopeAssetSnapshot: { normalizedValue: 'captured.fixture.test' }, reconPlan: { activityMode: 'PASSIVE', boundary: { normalizedValue: 'captured.fixture.test' }, stages: [{ name: 'HTTP surface', tools: ['httpx', 'unused-tool'] }], authorization: { exclusions: ['excluded.fixture.test'] } }, reconSteps: { create: [
    { name: 'HTTP surface', position: 0, state: 'PARTIAL', reason: 'Authorization: Bearer REASON_SECRET', details: { capabilities: [{ providersAttempted: [{ provider: 'httpx' }] }] } },
    { name: 'Ports / services', position: 1, state: 'SKIPPED_NOT_APPLICABLE', reason: 'Passive only' },
  ] } } });
  await prisma.reconArtifact.createMany({ data: [
    { kind: 'url', verification: 'DISCOVERED', value: { url: 'https://unprobed.fixture.test/login' } },
    { kind: 'endpoint', verification: 'OBSERVED', value: { url: 'https://captured.fixture.test/api', statusCode: 403 } },
  ].map((entry, i) => ({ ...entry, scanRunId: scan.id, scopeAssetId: asset.id, canonicalKey: String(i), scopeState: 'IN_SCOPE', sources: [], firstSeenAt: new Date(), lastSeenAt: new Date() })) });
  await prisma.scanLog.create({ data: { scanRunId: scan.id, stream: 'STDERR', line: 'httpx --password "LOG_SECRET"' } });
  web = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { env, stdio: 'ignore' });
  for (let i = 0; ; i++) { try { if ((await fetch(origin + '/api/health')).ok) break; } catch {} if (i > 150) throw Error('Web readiness timeout'); await new Promise(r => setTimeout(r, 100)); }
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  let foreign = 0;
  await context.route('**/*', route => { if (new URL(route.request().url()).origin !== origin) { foreign++; return route.abort(); } return route.continue(); });
  const anonymous = await context.request.get(origin + '/api/programs', { maxRedirects: 0 });
  check('anonymous API JSON contract', () => { assert.equal(anonymous.status(), 401); assert.equal(anonymous.headers()['location'], undefined); });
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await login(page, owner.email, password);
  for (const mode of ['light', 'dark']) for (const width of [1280, 390]) {
    await page.evaluate(theme => localStorage.setItem('theme', theme), mode); await page.emulateMedia({ colorScheme: mode }); await page.setViewportSize({ width, height: 900 });
    await page.goto(`${origin}/recon/runs/${parent.id}`); await page.getByRole('heading', { name: 'Recon run', exact: true }).waitFor();
    const report = page.getByRole('region', { name: 'Report', exact: true });
    // The outer report section is labelled by its heading, available as a region.
    assert.equal(await page.locator('html').getAttribute('data-theme'), mode);
    await page.screenshot({ path: `/tmp/bh-post-v1/recon-${mode}-${width}.png`, fullPage: true });
    const text = await report.innerText();
    check(`${mode}/${width}: facts and captured scope`, () => { assert(text.includes('Captured-UA')); assert(text.includes('captured.fixture.test')); assert(text.includes('not recorded')); assert(!text.includes('Current-UA')); assert(!text.includes('GET https://')); assert(!text.includes('REASON_SECRET')); });
    const responsive = await page.locator('dt', { hasText: /^Responsive hosts$/ }).locator('..').innerText();
    check(`${mode}/${width}: discovery is not responsiveness`, () => { assert(responsive.includes('captured.fixture.test')); assert(!responsive.includes('unprobed.fixture.test')); });
    const portText = await page.getByRole('region', { name: 'Ports and services', exact: true }).innerText();
    check(`${mode}/${width}: skipped ports remain unknown`, () => assert(portText.includes('network coverage remains unknown')));
    await page.getByText(/Raw execution output \(/).click();
    const raw = await page.locator('pre').innerText();
    check(`${mode}/${width}: logs and layout`, () => { assert(!raw.includes('LOG_SECRET')); assert(raw.includes('REDACTED')); });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    check(`${mode}/${width}: viewport has no horizontal overflow`, () => assert.equal(overflow, false));
    await page.reload(); await page.getByRole('heading', { name: 'Recon run', exact: true }).waitFor();
  }
  const exported = await context.request.get(`${origin}/api/recon/runs/${parent.id}/report`), markdown = await exported.text();
  check('Markdown export: fallback, snapshots, secrets, unknown method', () => { assert.equal(exported.status(), 200); assert(markdown.includes('## Research Handoff')); assert(markdown.includes('Captured-UA')); assert(!markdown.includes('Current-UA')); assert(!markdown.includes('REASON_SECRET')); assert(markdown.includes('Invocation not recorded')); });
  await page.goto(origin + '/recon'); await page.getByRole('link', { name: 'Open latest Recon run for Reliability fixture' }).click(); await page.waitForURL(`${origin}/recon/runs/${parent.id}`);
  await page.goBack(); await page.waitForURL(origin + '/recon'); await page.goForward(); await page.waitForURL(`${origin}/recon/runs/${parent.id}`);
  check('Recon navigation, refresh, back and forward', () => assert(page.url().endsWith(parent.id)));
  const unknown = await context.request.get(origin + '/api/recon/runs/missing/report');
  check('invalid report ID', () => assert.equal(unknown.status(), 404));
  const otherContext = await browser.newContext(), other = await otherContext.newPage(); await login(other, outsider.email, password);
  const denied = await otherContext.request.get(`${origin}/api/recon/runs/${parent.id}/report`);
  check('ownership isolation', () => assert.equal(denied.status(), 404));
  check('no page exceptions or foreign browser requests', () => { assert.deepEqual(errors, []); assert.equal(foreign, 0); });
  console.log(`POST_V1_BROWSER: ${checks} passed, 0 failed, 0 skipped`);
} finally {
  if (browser) await browser.close();
  if (web && web.exitCode === null) { const end = new Promise(r => web.once('exit', r)); web.kill('SIGTERM'); const timer = setTimeout(() => web.kill('SIGKILL'), 3000); await end; clearTimeout(timer); }
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await prisma.$disconnect();
}
