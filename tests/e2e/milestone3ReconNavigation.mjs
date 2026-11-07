import assert from 'node:assert/strict';

/** Same isolated application/schema as the post-v1 suite. All changes below
 * are synthetic DB records; no worker, scan start or external target request. */
export async function auditMilestone3Recon({ prisma: p, owner, origin, context, page, otherContext }) {
  let checks = 0;
  for (const theme of ['light', 'dark']) for (const width of [1280, 390]) {
    await page.evaluate(value => localStorage.setItem('theme', value), theme);
    await page.emulateMedia({ colorScheme: theme }); await page.setViewportSize({ width, height: 900 });
    const program = await p.bountyProgram.create({ data: { ownerId: owner.id, companyName: `M3 ${theme} ${width}`, requiredUserAgent: 'Current-M3-UA' } });
    const home = `${origin}/targets/${program.id}`, history = `${origin}/recon?program=${program.id}&pageSize=25`;
    await page.goto(home); await page.getByText('No Recon runs recorded.', { exact: true }).waitFor();
    const openHistory = page.getByRole('link', { name: 'Complete Recon history', exact: true }); await openHistory.focus(); await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Recon history — ' + program.companyName, exact: true }).waitFor();
    await page.getByText('No Recon runs recorded.', { exact: false }).waitFor(); checks++;
    const ids = Array.from({ length: 51 }, (_, i) => program.id + '_' + String(i).padStart(3, '0'));
    await p.targetReconRun.createMany({ data: ids.map(id => ({ id, programId: program.id, createdAt: new Date('2026-01-01'), status: 'COMPLETED', outcome: null })) });
    await page.goto(history);
    const nav = page.getByRole('navigation', { name: 'Recon history pages', exact: true });
    await nav.getByRole('status').filter({ hasText: 'Page 1 of 3 · 51 runs' }).waitFor();
    await page.getByRole('columnheader',{name:'Recorded executions',exact:true}).waitFor();
    const runLinks = page.locator('tbody a'); assert.equal(await runLinks.count(), 25); assert((await runLinks.first().innerText()).includes(ids[50]));
    await nav.getByRole('link', { name: 'Next page', exact: true }).focus(); await page.keyboard.press('Enter');
    await nav.getByRole('status').filter({ hasText: 'Page 2 of 3' }).waitFor(); assert.equal(new URL(page.url()).searchParams.get('program'), program.id);
    await page.reload(); await nav.getByRole('status').filter({ hasText: 'Page 2 of 3' }).waitFor();
    await nav.getByRole('link', { name: 'Next page', exact: true }).click(); await nav.getByRole('status').filter({ hasText: 'Page 3 of 3' }).waitFor();
    assert((await runLinks.first().innerText()).includes(ids[0]));
    await page.goBack(); await nav.getByRole('status').filter({ hasText: 'Page 2 of 3' }).waitFor();
    await page.goForward(); await nav.getByRole('status').filter({ hasText: 'Page 3 of 3' }).waitFor(); checks++;
    await runLinks.first().focus(); await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Recon run', exact: true }).waitFor(); assert.equal(new URL(page.url()).pathname, '/recon/runs/' + ids[0]);
    await page.getByText('Result unknown', { exact: true }).first().waitFor();
    await page.getByRole('link', { name: 'Run history', exact: true }).click(); await nav.getByRole('status').filter({ hasText: 'Page 3 of 3' }).waitFor();
    await page.getByRole('link', { name: 'Back to ' + program.companyName, exact: true }).click(); await page.waitForURL(home);
    await page.getByRole('link', { name: 'Latest Recon run', exact: true }).click(); await page.waitForURL(origin + '/recon/runs/' + ids[50]); checks++;
    // Normalized invalid/beyond-end page queries retain the exact Target.
    await page.goto(history + '&program=ambiguous'); await page.getByRole('heading', {name:'404',exact:true}).waitFor();
    await page.goto(history + '&page=bad'); await nav.getByRole('status').filter({ hasText: 'Page 1 of 3' }).waitFor();
    await page.goto(history + '&page=999'); await nav.getByRole('status').filter({ hasText: 'Page 3 of 3' }).waitFor();
    await p.targetReconRun.delete({ where: { id: ids[0] } }); await page.reload(); await nav.getByRole('status').filter({ hasText: 'Page 2 of 2 · 50 runs' }).waitFor(); checks++;
    if (otherContext) {
      // Next documents can stream a 200 shell before notFound resolves. Check
      // the actual not-found UI and non-disclosure; APIs must remain exact404.
      const privatePage = await otherContext.newPage();
      try {
        for (const url of [history, origin + '/recon/runs/' + ids[50]]) {
          const response = await privatePage.goto(url); assert([200, 404].includes(response.status()));
          await privatePage.getByRole('heading', {name:'404', exact:true}).waitFor();
          assert(!(await privatePage.locator('body').innerText()).includes(program.companyName));
          assert(await privatePage.locator('meta[name="robots"][content="noindex"]').count() > 0);
        }
      } finally { await privatePage.close(); }
      assert.equal((await otherContext.request.get(`${origin}/api/programs/${program.id}/recon?runId=${ids[50]}`)).status(), 404);
      checks++;
    }
    const scope = await p.scope.create({ data: { userId: owner.id, hostPattern: 'm3.fixture.test', status: 'APPROVED' } });
    const asset = await p.scopeAsset.create({ data: { programId: program.id, originalValue: 'm3.fixture.test', normalizedValue: 'm3.fixture.test', format: 'DOMAIN', type: 'WEB_APPLICATION' } });
    const target = await p.target.create({ data: { userId: owner.id, programId: program.id, scopeId: scope.id, scopeAssetId: asset.id, host: 'm3.fixture.test' } });
    const runId = ids[50];
    await p.targetReconRun.update({ where: { id: runId }, data: { status: 'QUEUED' } });
    const scan = await p.scanRun.create({ data: { type: 'RECON', targetId: target.id, scopeAssetId: asset.id, targetReconRunId: runId, status: 'QUEUED', requiredUserAgent: 'Captured-M3-UA', scopeAssetSnapshot: { normalizedValue: 'captured.m3.fixture.test' }, reconPlan: { stages: [{ name: 'HTTP surface', tools: ['httpx', 'never-executed'] }] }, reconSteps: { create: { name: 'HTTP surface', position: 0, state: 'PENDING' } } } });
    await p.scanLog.create({ data: { scanRunId: scan.id, stream: 'STDOUT', line: 'Initial recorded output' } });
    const heartbeat = `**/api/programs/${program.id}/recon?runId=${runId}`;
    let polls = 0;
    const handler = async route => { polls++; if (polls === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }); return route.continue(); };
    await context.route(heartbeat, handler);
    await page.goto(origin + '/recon/runs/' + runId); await page.getByText('Queued', { exact: true }).first().waitFor();
    const details = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Raw execution output' }) });
    const summary = details.locator('summary'); await summary.focus(); await page.keyboard.press('Enter'); assert.equal(await details.getAttribute('open'), '');
    await page.getByText('Live update unavailable.', { exact: false }).waitFor(); checks++;
    await p.targetReconRun.update({ where: { id: runId }, data: { status: 'RUNNING', startedAt: new Date() } });
    await p.scanRun.update({ where: { id: scan.id }, data: { status: 'RUNNING' } });
    await p.reconPipelineStep.updateMany({ where: { scanRunId: scan.id }, data: { state: 'RUNNING', details: { capabilities: [{ capability: 'http_probe', providersAttempted: [{ provider: 'httpx', state: 'RUNNING', observations: 0 }] }] } } });
    await p.scanLog.create({ data: { scanRunId: scan.id, stream: 'STDOUT', line: 'New durable live output' } });
    await page.getByText('New durable live output', { exact: false }).waitFor();
    assert.equal(await details.getAttribute('open'), ''); assert(await summary.evaluate(el => el === document.activeElement));
    await page.getByText('Live updates every 5 seconds.', { exact: true }).waitFor();
    assert((await page.locator('body').innerText()).includes('Planned tools: httpx · never-executed')); checks++;
    // Report/observations and real provider attempts arrive independently of
    // the parent status. Refresh must show these even while it stays RUNNING.
    await summary.scrollIntoViewIfNeeded();
    const readingPosition = await summary.evaluate(el => el.getBoundingClientRect().top);
    await p.reconArtifact.create({ data: { scanRunId: scan.id, scopeAssetId: asset.id, kind: 'endpoint', canonicalKey: 'm3', value: { url: 'https://captured.m3.fixture.test/new-recorded-path', statusCode: 403 }, scopeState: 'IN_SCOPE', verification: 'OBSERVED', sources: [], firstSeenAt: new Date(), lastSeenAt: new Date() } });
    await p.reconPipelineStep.updateMany({ where: { scanRunId: scan.id }, data: { state: 'PARTIAL', details: { capabilities: [{ capability: 'http_probe', providersAttempted: [{ provider: 'httpx', state: 'FAILED', failure: {message: 'Recorded provider timeout'}, artifactsProduced: 0 }, { provider: 'fallback-fixture', state: 'COMPLETED', artifactsProduced: 1 }] }] } } });
    await page.getByText('Recorded provider timeout', { exact: false }).first().waitFor();
    await page.getByRole('region', { name: 'Report', exact: true }).getByText('https://captured.m3.fixture.test/new-recorded-path', { exact: false }).first().waitFor();
    assert.equal(await details.getAttribute('open'), ''); assert(await summary.evaluate(el => el === document.activeElement));
    assert(Math.abs((await summary.evaluate(el => el.getBoundingClientRect().top)) - readingPosition) < 8, 'retain the reading anchor during report updates'); checks++;
    if (theme === 'light' && width === 1280) {
      await details.locator('pre').evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); });
      await p.scanLog.create({ data: { scanRunId: scan.id, stream: 'STDOUT', line: 'Recorded while copying' } });
      await page.waitForResponse(response => new URL(response.url()).searchParams.get('runId') === runId && response.ok());
      await page.waitForTimeout(1000);
      assert.equal(await page.getByText('Recorded while copying', {exact:false}).count(), 0, 'selection must not be replaced during copy');
      await page.evaluate(() => window.getSelection().removeAllRanges());
      await page.getByText('Recorded while copying', {exact:false}).waitFor(); checks++;
    }
    const endState = width === 390 ? 'FAILED' : 'COMPLETED';
    await p.scanRun.update({ where: { id: scan.id }, data: { status: endState, outcome: endState === 'FAILED' ? 'FAILED' : 'PARTIAL', finishedAt: new Date() } });
    await p.targetReconRun.update({ where: { id: runId }, data: { status: endState, outcome: endState === 'FAILED' ? 'FAILED' : 'PARTIAL', finishedAt: new Date() } });
    await page.getByText('Run finished. Live updates stopped.', { exact: true }).waitFor();
    const stoppedAt = polls; await page.waitForTimeout(6500); assert.equal(polls, stoppedAt, 'terminal view must stop heartbeat');
    assert.equal(await details.getAttribute('open'), '');
    assert.equal((await p.scopeAsset.findUniqueOrThrow({ where: { id: asset.id } })).active, true);
    assert.deepEqual((await p.scanRun.findUniqueOrThrow({ where: { id: scan.id } })).scopeAssetSnapshot, scan.scopeAssetSnapshot);
    assert.equal(await p.scanJobOutbox.count({ where: { scanRunId: scan.id } }), 0); checks++;
    await context.unroute(heartbeat, handler);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.equal(await page.locator('html').getAttribute('data-theme'), theme); checks++;
  }
  console.log(`MILESTONE3_RECON_BROWSER: ${checks} passed, 0 failed, 0 skipped`);
}
