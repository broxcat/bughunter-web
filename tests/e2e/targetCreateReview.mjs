// Browser fixture using the real form, authenticated app and disposable SQL.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright-chromium';
import bcrypt from 'bcryptjs';

const exec = promisify(execFile);
const db = process.env.TEST_DATABASE_URL;
const redis = process.env.TEST_ABUSE_REDIS_URL;
const container = process.env.TEST_ABUSE_REDIS_CONTAINER;
assert(db && redis && container, 'Use the disposable browser test infrastructure.');
const label = '{{index .Config.Labels "bughunter.queue-test"}}';
assert.equal((await exec('docker', ['inspect', '--format', label, container])).stdout.trim(), 'disposable');
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
await new Promise(resolve => server.close(resolve));
const origin = 'http://127.0.0.1:' + port;
const p = new PrismaClient({ datasourceUrl: db });
const output = process.env.TARGET_FORM_SCREENSHOTS;
const fixtureUrl = 'https://hackerone.com/example-private';
const userAgent = 'ReviewFixture/1.0';
const logs = [];
let web, browser;
try {
  const password = randomUUID();
  const user = await p.user.create({ data: { email: randomUUID() + '@example.test', passwordHash: await bcrypt.hash(password, 10) } });
  const command = process.env.TARGET_FORM_DEV === '1' ? ['dev'] : ['start'];
  web = spawn(process.execPath, ['node_modules/next/dist/bin/next', ...command, '--hostname', '127.0.0.1', '--port', String(port)], {
    env: { ...process.env, DATABASE_URL: db, REDIS_URL: redis, AUTH_URL: origin, AUTH_SECRET: randomUUID(),
      CREDENTIALS_ENCRYPTION_KEY: 'ab'.repeat(32), ALLOW_PUBLIC_REGISTRATION: 'false', TRUST_PROXY_HEADERS: 'false', LOG_LEVEL: 'silent' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [web.stdout, web.stderr]) stream.on('data', chunk => { logs.push(String(chunk)); if (logs.length > 25) logs.shift(); });
  for (let attempt = 0; ; attempt++) {
    if (web.exitCode !== null || attempt > 200) throw Error('Target form web did not start.');
    try { if ((await fetch(origin + '/api/health')).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, colorScheme: 'light' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const capture = async name => {
    if (!output) return;
    await mkdir(output, { recursive: true });
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }); });
    await page.screenshot({ path: join(output, name), fullPage: true, animations: 'disabled', style: 'nextjs-portal { display: none !important; }' });
  };
  await page.goto(origin + '/login');
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(origin + '/targets');
  await page.getByRole('link', { name: 'Create target', exact: true }).click();

  const scopeIn = [{ ref: 'api', originalValue: 'https://api.example.test', normalizedValue: 'https://api.example.test/', sourceType: 'API' }];
  const nonAutomatable = [{ ref: 'app', originalValue: 'com.example.mobile', sourceType: 'Android', reason: 'Unsupported asset for automated testing' }];
  const unrepresentedRules = [{ text: 'Keep requests below three per second.' }];
  await page.route('**/api/programs/import-preview', route => {
    assert.equal(route.request().postDataJSON().url, fixtureUrl);
    return route.fulfill({ json: { status: 'PREVIEW', preview: {
      url: fixtureUrl, platform: 'HACKERONE', name: 'Example private program', scopeIn, scopeOut: [], nonAutomatable,
      unrepresentedAssets: [], unrepresentedRules, nonQualifying: ['OPEN_REDIRECT'],
      policy: { sourceSnapshot: { rules: unrepresentedRules[0].text }, exclusions: ['https://api.example.test/admin/*'] },
    } } });
  });
  await page.getByLabel('Program URL').fill(fixtureUrl);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Import ready for review' }).waitFor();
  await page.getByLabel('Name', { exact: true }).fill('Reviewed private fixture');
  await page.getByLabel('Requests per second').fill('2');
  await page.getByLabel('Required User-Agent').fill(userAgent);
  await page.getByLabel('Converted above').check();
  await page.getByLabel('Allow automation after review').check();
  await capture('target-import-preview.png');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL(/\/targets\/(?!new)[^/?]+$/);
  await page.getByRole('status').filter({ hasText: 'Ready for Recon' }).waitFor();
  const imported = await p.bountyProgram.findFirstOrThrow({ where: { ownerId: user.id, companyName: 'Reviewed private fixture' },
    include: { scopeAssets: true, executionPolicies: true } });
  assert.deepEqual(imported.nonQualifying, ['OPEN_REDIRECT']);
  assert.equal(imported.scopeAssets.length, 1);
  assert.equal(imported.scopeAssets[0].type, 'API');
  assert.equal(imported.executionPolicies[0].policy.reviewState, 'OWNER_REVIEWED');
  assert.equal(imported.executionPolicies[0].policy.sourceSnapshot.documentedAssets[0].originalValue, 'com.example.mobile');
  assert.equal(await p.targetReconRun.count({ where: { programId: imported.id } }), 0);
  const anonymous = await browser.newContext();
  assert.equal((await anonymous.request.get(origin + '/api/programs/' + imported.id)).status(), 401);
  await anonymous.close();

  await page.goto(origin + '/targets/new');
  await page.getByLabel('Platform', { exact: true }).selectOption('PRIVATE');
  await page.getByLabel('Name', { exact: true }).fill('Manual review fixture');
  await page.getByRole('button', { name: 'Add asset', exact: true }).click();
  await page.getByLabel('Asset 1', { exact: true }).fill('app.example.test');
  await page.getByLabel(/^Out of scope/).fill('APP.example.test');
  assert(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled());
  await page.getByLabel(/^Out of scope/).fill('admin.example.test');
  await page.getByLabel('Add a rule').fill('Testing is permitted only in the published maintenance window.');
  await page.getByRole('button', { name: 'Add rule', exact: true }).click();
  await page.getByLabel('Required User-Agent').fill(userAgent);
  await page.getByLabel('Allow automation after review').check();
  await capture('target-manual-entry.png');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL(/\/targets\/(?!new)[^/?]+$/);
  await page.getByRole('status').filter({ hasText: 'Automation is blocked by unrepresented program or scope rules.' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('TARGET_CREATE_REVIEW: imported review, manual review and scope conflict passed');
} catch (error) {
  console.error(logs.join('').slice(-8000));
  throw error;
} finally {
  await browser?.close();
  if (web && web.exitCode === null) {
    const exited = new Promise(resolve => web.once('exit', resolve));
    web.kill('SIGTERM');
    const timer = setTimeout(() => web.kill('SIGKILL'), 3000);
    await exited;
    clearTimeout(timer);
  }
  await p.$disconnect();
}
