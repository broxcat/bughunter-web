// Real built web + disposable SQL/Redis; queued Recon is labelled synthetic.
// No worker, native CLI or model is simulated as an acceptance result here.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright-chromium';
const exec = promisify(execFile), db = process.env.TEST_DATABASE_URL, redis = process.env.TEST_ABUSE_REDIS_URL, container = process.env.TEST_ABUSE_REDIS_CONTAINER;
assert(db && redis && container, 'Use npm run test:queue -- --target-browser');
assert.equal((await exec('docker', ['inspect', '--format', '{{index .Config.Labels "bughunter.queue-test"}}', container])).stdout.trim(), 'disposable');
const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port; await new Promise(r => server.close(r));
const origin = `http://127.0.0.1:${port}`, root = await mkdtemp(join(tmpdir(), 'asset-browser-')), p = new PrismaClient({ datasourceUrl: db });
let web, browser, page;
try {
  const password = randomUUID(), user = await p.user.create({ data: { email: randomUUID() + '@example.test', passwordHash: await bcrypt.hash(password, 10) } });
  web = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { env: { ...process.env, DATABASE_URL: db, REDIS_URL: redis, AUTH_URL: origin, AUTH_SECRET: randomUUID(), CREDENTIALS_ENCRYPTION_KEY: 'ab'.repeat(32), RESEARCH_CONSOLE_ROOT: root, ALLOW_PUBLIC_REGISTRATION: 'false', TRUST_PROXY_HEADERS: 'false', LOG_LEVEL: 'silent' }, stdio: 'ignore' });
  for (let n = 0;; n++) { if (web.exitCode !== null) throw new Error('Isolated web stopped'); try { if ((await fetch(origin + '/api/health')).ok) break; } catch {} if (n > 100) throw new Error('Web readiness timeout'); await new Promise(r => setTimeout(r, 100)); }
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] }); const context = await browser.newContext(); page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/login'); await page.getByLabel('Email', { exact: true }).fill(user.email); await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.waitForURL(origin + '/targets');
  await page.getByRole('button', { name: 'Create Target', exact: true }).click(); await page.getByLabel('Company / Program name *', { exact: true }).fill('Asset workflow fixture'); await page.getByLabel(/^Required User-Agent/).fill('Asset-Browser/1'); await page.getByRole('button', { name: 'Create Target', exact: true }).click(); await page.waitForURL(/\/targets\/[^/?]+$/);
  const id = new URL(page.url()).pathname.split('/').at(-1);
  const add = async (value, importance, type) => { await page.getByRole('button', { name: '+ Add asset', exact: true }).click(); await page.getByLabel('Asset', { exact: true }).fill(value); if (importance) await page.getByLabel('New asset value').selectOption(importance); if (type) await page.getByLabel('New asset type').selectOption(type); const response = page.waitForResponse(r => r.url().endsWith(`/programs/${id}/assets`) && r.request().method() === 'POST'); await page.getByRole('button', { name: 'Save asset', exact: true }).click(); assert.equal((await response).status(), 201); };
  await add('\\*.example.test', 'CRITICAL'); await add('https://app.example.test/api/', 'HIGH', 'API');
  const rows = page.locator('tbody tr'); await rows.filter({ hasText: 'https://app.example.test/api/' }).waitFor(); assert((await rows.first().innerText()).includes('*.example.test'));
  const apiRow = rows.filter({ hasText: 'https://app.example.test/api/' }); await apiRow.getByRole('button', { name: 'Edit', exact: true }).click(); await page.getByLabel('Value https://app.example.test/api/').selectOption('LOW'); await apiRow.getByRole('button', { name: 'Save', exact: true }).click(); await apiRow.getByText('Low', { exact: true }).waitFor();
  const asset = await p.scopeAsset.findFirstOrThrow({ where: { programId: id, format: 'URL' } }); assert.equal(asset.typeSource, 'USER'); assert.equal(asset.assetValue, 'LOW');
  await apiRow.getByRole('button', { name: 'Recon', exact: true }).click(); await page.waitForURL(origin + `/targets/${id}?tab=Recon`); await apiRow.getByRole('cell', { name: 'Queued', exact: true }).waitFor();
  const queued = await p.scanRun.findFirstOrThrow({ where: { scopeAssetId: asset.id }, include: { reconSteps: true } }); assert.equal(queued.reconSteps.length, 11); assert.equal(queued.scopeAssetSnapshot.normalizedValue, asset.normalizedValue);
  assert.equal(await p.scanExecutionAttempt.count({ where: { scanRunId: queued.id } }), 0, 'No worker runs in this browser fixture');
  await p.scanRun.update({ where: { id: queued.id }, data: { status: 'COMPLETED', outcome: 'PARTIAL', finishedAt: new Date(), error: 'Synthetic browser fixture: one collector unavailable.' } });
  await page.reload(); await apiRow.getByRole('cell', { name: 'Partial', exact: true }).waitFor(); await apiRow.getByRole('button', { name: 'View', exact: true }).click(); await page.getByRole('button', { name: 'Refresh observations', exact: true }).waitFor();
  for (const path of [`/api/programs/${id}/scope.md`, `/api/programs/${id}/assets/${asset.id}/scope.md`]) { const r = await context.request.get(origin + path); assert.equal(r.status(), 200); assert(r.headers()['content-disposition'].includes('-scope.md')); const text = await r.text(); assert(text.includes('LLM Safety Instructions') && text.includes(asset.id)); }
  await page.goto(origin + `/recon?program=${id}`); await page.waitForURL(origin + `/targets/${id}?tab=Recon`); assert.equal(await page.getByRole('button', { name: 'Start Recon', exact: true }).count(), 0);
  await apiRow.getByRole('button', { name: 'Delete', exact: true }).click(); await page.getByRole('button', { name: 'Remove asset', exact: true }).click(); await apiRow.waitFor({ state: 'detached' }); assert.equal(await p.scanRun.count({ where: { id: queued.id } }), 1);
  await page.screenshot({ path: '/tmp/bughunter-target-assets-desktop.png', fullPage: true }); await page.setViewportSize({ width: 390, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.screenshot({ path: '/tmp/bughunter-target-assets-mobile.png', fullPage: true });
  assert.deepEqual(errors, []); console.log('TARGET_ASSET_BROWSER_PASSED: create, escaped detection, user overrides, value ordering, per-asset enqueue, explicit partial state, observation view, both Markdown downloads, old Recon redirect, archive/history and mobile width.');
} catch (e) { if (page) await page.screenshot({ path: '/tmp/bughunter-target-assets-failure.png', fullPage: true }); throw e; }
finally { await browser?.close(); if (web && web.exitCode === null) { const end = new Promise(r => web.once('exit', r)); web.kill('SIGTERM'); const timer = setTimeout(() => web.kill('SIGKILL'), 3000); await end; clearTimeout(timer); } await p.$disconnect(); await rm(root, { recursive: true, force: true }); }
