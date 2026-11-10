// Browser fixture using the real form, authenticated app and disposable SQL.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright-chromium';
import bcrypt from 'bcryptjs';
import { verifyCampaignWorkflow } from './targetCampaignWorkflow.mjs';

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
const fixtures = new URL('../fixtures/program-intake/', import.meta.url);
const models = JSON.parse(await readFile(new URL('model.json', fixtures), 'utf8'));
const documents = Object.fromEntries(await Promise.all(['hackerone', 'yeswehack'].map(async name =>
  [name, await readFile(new URL(name + '.md', fixtures), 'utf8')])));
const userAgent = 'ReviewFixture/1.0';
const logs = [];
let web, browser, ai;
try {
  const password = randomUUID();
  const user = await p.user.create({ data: { email: randomUUID() + '@example.test', passwordHash: await bcrypt.hash(password, 10) } });
  const command = process.env.TARGET_FORM_DEV === '1' ? ['dev'] : ['start'];
  web = spawn(process.execPath, ['node_modules/next/dist/bin/next', ...command, '--hostname', '127.0.0.1', '--port', String(port)], {
    env: { ...process.env, DATABASE_URL: db, REDIS_URL: redis, AUTH_URL: origin, AUTH_SECRET: randomUUID(),
      CREDENTIALS_ENCRYPTION_KEY: 'ab'.repeat(32), ALLOW_PUBLIC_REGISTRATION: 'false', TRUST_PROXY_HEADERS: 'false', LOG_LEVEL: 'silent', HUNTER_USERNAME: 'fixture-hunter', DEFAULT_USER_AGENT: '' },
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

  await page.getByRole('link', { name: 'Settings', exact: true }).last().waitFor();
  assert(await page.getByRole('button', { name: 'Extract from Markdown' }).isDisabled());
  const programRule = 'Use only test accounts that you own.';
  const rawYesWeHack = [
    'Bug bounty', 'Public', 'Submit report', 'Public fixture company',
    'Reward', '€100 Low €250 Medium €800 High €2,000 Critical',
    'Program description', 'Keep traffic below 3 requests per second.', programRule,
    'Scopes', 'https://shop.example.test\tWeb application\tHigh',
    'Out of scopes', 'https://shop.example.test/admin/*',
    'Qualifying vulnerabilities', 'SQL Injection',
    'Non-qualifying vulnerabilities', 'Open Redirect',
    'Hunting requirements', 'User agent',
    "Please append to your user-agent header the following value: ' Fixture-<your yeswehack pseudo> '.",
  ].join('\n');
  await page.getByLabel('Program Markdown').fill(rawYesWeHack);
  await page.getByRole('button', { name: 'Extract from Markdown' }).click();
  await page.getByRole('status').filter({ hasText: 'Extraction ready for review' }).waitFor();
  assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'Public fixture company');
  assert.equal(await page.getByLabel('Reward critical').inputValue(), '2000');
  assert.equal(await page.getByLabel('Asset 1 value').inputValue(), 'HIGH');
  assert.equal(await page.getByLabel('User-Agent suffix').inputValue(), 'Fixture-<your yeswehack pseudo>');
  await page.getByText('1 program rule needs review. Automation is blocked.', { exact: true }).waitFor();
  const rule = page.getByRole('list', { name: 'Program rules needing review' }).getByRole('listitem');
  await rule.waitFor();
  assert.equal(await rule.innerText(), programRule);
  await page.getByRole('button', { name: 'Save and start', exact: true }).click();
  await page.waitForURL(/\/targets\/(?!new)[^/?]+$/);
  const rawTarget = await p.bountyProgram.findFirstOrThrow({ where: { ownerId: user.id, companyName: 'Public fixture company' },
    include: { executionPolicies: true, scopeAssets: true, campaign: true } });
  assert.equal(rawTarget.rewardCritical.toString(), '2000');
  assert.equal(rawTarget.scopeAssets[0].assetValue, 'HIGH');
  assert.equal(rawTarget.executionPolicies[0].policy.userAgentMode, 'APPEND');
  assert.equal(rawTarget.executionPolicies[0].policy.sourceSnapshot.sourceDocument, rawYesWeHack);
  assert.equal(rawTarget.campaign.state, 'BLOCKED');
  assert.deepEqual(rawTarget.executionPolicies[0].policy.sourceSnapshot.unrepresentedRules, [programRule]);
  assert.equal(await p.targetReconRun.count({ where: { programId: rawTarget.id } }), 0);
  await page.goto(origin + '/targets/new');

  ai = createHttpServer(async (request, response) => {
    try {
      assert.equal(request.url, '/api/chat');
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks));
      assert.equal(input.model, 'fixture-intake-model');
      assert.match(input.messages[0].content, /untrusted program data/);
      const { programDocument } = JSON.parse(input.messages[1].content);
      const key = Object.keys(documents).find(key => documents[key] === programDocument);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: { content: key ? JSON.stringify(models[key]) : '{"name":1}' } }));
    } catch {
      response.writeHead(500).end();
    }
  });
  await new Promise(resolve => ai.listen(0, '127.0.0.1', resolve));
  await p.aiProviderConfig.create({ data: {
    userId: user.id, provider: 'OLLAMA', model: 'fixture-intake-model', isActive: true,
    baseUrl: 'http://127.0.0.1:' + ai.address().port,
  } });
  await page.reload();
  await page.getByLabel('Program Markdown').waitFor();
  await capture('target-form-empty.png');
  await page.getByLabel('Name', { exact: true }).fill('Keep this on error');
  await page.getByLabel('Program Markdown').fill('# Deliberately invalid fixture');
  await page.getByRole('button', { name: 'Extract from Markdown' }).click();
  await page.getByRole('alert').filter({ hasText: 'invalid program extraction' }).waitFor();
  assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'Keep this on error');

  for (const key of ['hackerone', 'yeswehack']) {
    await page.goto(origin + '/targets/new');
    await page.getByLabel('Program Markdown').fill(documents[key]);
    await page.getByRole('button', { name: 'Extract from Markdown' }).click();
    await page.getByRole('status').filter({ hasText: 'Extraction ready for review' }).waitFor();
    assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), models[key].name);
    assert.equal(await page.getByLabel('Platform', { exact: true }).inputValue(), models[key].platform);
    assert.equal(await page.getByLabel('Asset 1', { exact: true }).inputValue(), models[key].scopeIn[0].value);
    assert.equal(await page.getByLabel('Asset 1 type').inputValue(), models[key].scopeIn[0].type);
    assert.equal(await page.getByRole('textbox', { name: /^Non-qualifying vulnerabilities/ }).inputValue(), models[key].nonQualifying.join('\n'));
    assert.equal(await page.getByLabel('Required headers').count(), 0);
    if (key === 'hackerone') {
      await page.getByText(/5 req\/s · 2 concurrent · header x-bug-bounty · brute force forbidden/).waitFor();
      await capture('target-form-from-markdown.png');
    }
    await page.getByRole('button', { name: 'Save and start', exact: true }).click();
    await page.waitForURL(/\/targets\/(?!new)[^/?]+$/);
    const saved = await p.bountyProgram.findFirstOrThrow({ where: { ownerId: user.id, companyName: models[key].name },
      include: { scopeAssets: true, executionPolicies: true, campaign: true } });
    assert.equal(saved.scopeAssets.length, 2);
    const policy = saved.executionPolicies[0].policy;
    assert.equal(policy.reviewState, 'OWNER_REVIEWED');
    assert.equal(policy.sourceSnapshot.sourceDocument, documents[key]);
    if (key === 'hackerone') {
      assert.deepEqual(saved.nonQualifying, ['OPEN_REDIRECT']);
      assert.deepEqual(policy.sourceSnapshot.nonQualifyingText, ['Self-XSS without an impact on another user']);
      assert.equal(policy.requiredHeaders[0].value, 'HackerOne-<username>');
      const started = await p.targetReconRun.findFirstOrThrow({ where: { programId: saved.id } });
      assert.equal(await p.scanJobOutbox.count({ where: { scanRun: { targetReconRunId: started.id } } }), 2);
      await page.getByRole('button', { name: 'Pause campaign', exact: true }).click();
      await page.getByRole('button', { name: 'Resume campaign', exact: true }).waitFor();
      await p.targetReconRun.update({ where: { id: started.id }, data: { status: 'CANCELLED', finishedAt: new Date() } });
    } else {
      assert.deepEqual(saved.nonQualifying, ['XSS']);
      assert.equal(policy.sourceSnapshot.documentedAssets[0].originalValue, 'com.altair.mobile');
      assert.equal(saved.campaign.state, 'BLOCKED');
      assert.equal(await p.targetReconRun.count({ where: { programId: saved.id } }), 0);
    }
  }

  await page.goto(origin + '/targets/new');
  await page.getByLabel('Platform', { exact: true }).selectOption('PRIVATE');
  await page.getByLabel('Name', { exact: true }).fill('Manual review fixture');
  await page.getByRole('button', { name: 'Add asset', exact: true }).click();
  await page.getByLabel('Asset 1', { exact: true }).fill('app.example.test');
  await page.getByLabel(/^Out of scope/).fill('APP.example.test');
  assert(await page.getByRole('button', { name: 'Save and start', exact: true }).isDisabled());
  await page.getByLabel(/^Out of scope/).fill('admin.example.test');
  await page.getByText('Configure DEFAULT_USER_AGENT.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Save and start', exact: true }).click();
  await page.waitForURL(/\/targets\/(?!new)[^/?]+$/);
  await page.getByRole('link', { name: 'Fix policy', exact: true }).click();
  await page.getByLabel('Required User-Agent').fill(userAgent);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForURL(/\/targets\/[^/?]+\?saved=1$/);
  const manual = await p.bountyProgram.findFirstOrThrow({ where: { ownerId: user.id, companyName: 'Manual review fixture' } });
  await p.targetCampaign.update({ where: { programId: manual.id }, data: { state: 'PAUSED', requestedAt: null } });
  await verifyCampaignWorkflow({ page, context, origin, p, ownerId: user.id });
  assert.deepEqual(errors, []);
  console.log('TARGET_CREATE_REVIEW: both Markdown fixtures, invalid extraction, manual review and scope conflict passed');
} catch (error) {
  console.error(logs.join('').slice(-8000));
  throw error;
} finally {
  await browser?.close();
  if (ai?.listening) { ai.closeAllConnections(); await new Promise(resolve => ai.close(resolve)); }
  if (web && web.exitCode === null) {
    const exited = new Promise(resolve => web.once('exit', resolve));
    web.kill('SIGTERM');
    const timer = setTimeout(() => web.kill('SIGKILL'), 3000);
    await exited;
    clearTimeout(timer);
  }
  await p.$disconnect();
}
