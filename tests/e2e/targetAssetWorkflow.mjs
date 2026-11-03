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
  const apiRow=rows.filter({hasText:'https://app.example.test/api/'});
  const edit=page.waitForResponse(r=>r.url().includes('/assets/')&&r.request().method()==='PATCH');await apiRow.getByLabel('Value https://app.example.test/api/').selectOption('LOW');assert.equal((await edit).status(),200);
  const asset=await p.scopeAsset.findFirstOrThrow({where:{programId:id,format:'URL'}});assert.equal(asset.typeSource,'USER');assert.equal(asset.assetValue,'LOW');
  assert.deepEqual(await page.locator('th').allTextContents(),['Asset','Format','Type','Asset Value','Recon']);
  assert.equal(await page.getByRole('button',{name:'Recon',exact:true}).count(),1);
  assert.equal(await page.getByText(/Provider diagnostics|MCP diagnostics|Raw scanner logs|Recon strategy/).count(),0);
  const started=page.waitForResponse(r=>r.url().endsWith(`/programs/${id}/recon`)&&r.request().method()==='POST');await page.getByRole('button',{name:'Recon',exact:true}).click();assert.equal((await started).status(),202);
  const parent=await p.targetReconRun.findFirstOrThrow({where:{programId:id}}),scans=await p.scanRun.findMany({where:{targetReconRunId:parent.id},include:{reconSteps:true}});assert.equal(scans.length,2);assert(scans.every(s=>s.reconSteps.length===12));assert.equal(await p.scanExecutionAttempt.count({where:{scanRunId:{in:scans.map(s=>s.id)}}}),0,'Controlled queued states, no worker in this browser fixture');
  const queued=scans.find(s=>s.scopeAssetId===asset.id);for(const [i,path]of ['/login','/register','/api/auth/register','/api/auth/reset-password','/api/courses'].entries())await p.reconArtifact.create({data:{scanRunId:queued.id,scopeAssetId:asset.id,kind:'endpoint',canonicalKey:'browser-'+i,value:{url:'https://app.example.test/api'+path},scopeState:'IN_SCOPE',verification:'DISCOVERED',firstSeenAt:new Date(),lastSeenAt:new Date(),sources:[{tool:'browser-fixture',sourceRef:'controlled:'+i,observedAt:new Date().toISOString()}]}});
  await p.scanRun.updateMany({where:{targetReconRunId:parent.id},data:{status:'COMPLETED',outcome:'PARTIAL',artifactVersion:2,finishedAt:new Date(),error:'Controlled browser fixture: collector unavailable.'}});
  await p.scanRun.updateMany({where:{targetReconRunId:parent.id,id:{not:queued.id}},data:{outcome:'FAILED'}});
  await p.targetReconRun.update({where:{id:parent.id},data:{status:'COMPLETED',outcome:'PARTIAL',finishedAt:new Date(),scopeMarkdown:'Controlled browser readiness fixture'}});
  await page.reload();await apiRow.getByRole('cell',{name:'Partial · 5',exact:true}).waitFor();await rows.filter({hasText:'*.example.test'}).getByRole('cell',{name:'Failed',exact:true}).waitFor();
  await page.getByRole('link',{name:'https://app.example.test/api/',exact:true}).click();await page.waitForURL(origin+'/scopes/'+asset.id);await page.getByRole('heading',{name:'Recon summary',exact:true}).waitFor();await page.getByText('Partial · 5 normalized discoveries',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Recon',exact:true}).count(),0);
  await page.getByText('Browse all structured artifacts · 5',{exact:true}).click();await page.getByLabel('Artifact kind').selectOption('endpoint');await page.getByText(/5 artifacts · page 1/).waitFor();
  for(const path of [`/api/programs/${id}/scope.md`,`/api/programs/${id}/assets/${asset.id}/scope.md`]){const r=await context.request.get(origin+path);assert.equal(r.status(),200);assert(r.headers()['content-disposition'].includes('-scope.md'));const text=await r.text();assert(text.includes('format_version: 2')&&text.includes('Safety Boundary')&&text.includes(asset.id));}
  await page.goto(origin+'/scopes?target='+id);await page.getByLabel('Filter Target').selectOption(id);await page.getByRole('link',{name:asset.normalizedValue,exact:true}).waitFor();
  await page.goto(origin+'/targets/'+id);await page.getByRole('button',{name:'Recon',exact:true}).click();await page.getByRole('button',{name:'Cancel Recon',exact:true}).waitFor();await page.getByRole('button',{name:'Cancel Recon',exact:true}).click();await page.getByRole('button',{name:'Cancel Recon',exact:true}).waitFor({state:'detached'});
  await page.goto(origin+'/scopes/'+asset.id);await page.getByText('Archive scope authorization',{exact:true}).click();await page.getByRole('button',{name:'Archive asset',exact:true}).click();await page.getByRole('button',{name:'Confirm archive',exact:true}).click();await page.getByText('Archived — no new Recon',{exact:true}).waitFor();assert.equal(await p.scanRun.count({where:{id:queued.id}}),1);
  await page.goto(origin+'/targets/'+id);await rows.filter({hasText:asset.normalizedValue}).waitFor({state:'detached'});
  await rows.filter({hasText:'*.example.test'}).waitFor();
  await page.screenshot({ path: '/tmp/bughunter-target-assets-desktop.png', fullPage: true }); await page.setViewportSize({ width: 390, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.screenshot({ path: '/tmp/bughunter-target-assets-mobile.png', fullPage: true });
  assert.deepEqual(errors, []); console.log('TARGET_ASSET_BROWSER_PASSED: minimal five-column Target, escaped detection, inline overrides, one-click all-assets parent, artifact count, Scope details/filter/inventory, v2 downloads, cancellation, archive/history and mobile width.');
} catch (e) { if (page) await page.screenshot({ path: '/tmp/bughunter-target-assets-failure.png', fullPage: true }); throw e; }
finally { await browser?.close(); if (web && web.exitCode === null) { const end = new Promise(r => web.once('exit', r)); web.kill('SIGTERM'); const timer = setTimeout(() => web.kill('SIGKILL'), 3000); await end; clearTimeout(timer); } await p.$disconnect(); await rm(root, { recursive: true, force: true }); }
