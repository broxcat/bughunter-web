import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function verifyCampaignWorkflow({ page, context, origin, p, ownerId }) {
  const path = id => origin + '/targets/' + id;
  const campaignRequests = start => requestPaths.slice(start).filter(value => value.includes('/api/programs') || value === new URL(page.url()).pathname);
  const requestPaths = [];
  const onRequest = request => {
    const url = new URL(request.url());
    if (url.pathname.includes('/api/programs') || url.searchParams.has('_rsc')) requestPaths.push(url.pathname);
  };
  page.on('request', onRequest);
  const capture = async name => {
    const directory = process.env.TARGET_CAMPAIGN_SCREENSHOTS;
    if (!directory) return;
    await mkdir(directory, { recursive: true });
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }); });
    await page.screenshot({ path: join(directory, name + '.png'), fullPage: true, animations: 'disabled', style: 'nextjs-portal { display: none !important; }' });
  };
  const primary = (role, name) => page.locator('main header').getByRole(role, { name, exact: true });
  const blocked = await p.bountyProgram.create({ data: {
    ownerId, companyName: 'Orion — policy review', platform: 'HACKERONE', requiredUserAgent: 'CampaignFixture/1',
    scopeAssets: { create: { originalValue: 'app.example.test', normalizedValue: 'app.example.test', format: 'SUBDOMAIN', type: 'WEB_APPLICATION' } },
    executionPolicies: { create: { version: 1, policy: {
      automationAllowed: true, requiredUserAgent: 'CampaignFixture/1', requiredHeaders: [], exclusions: [],
      requestsPerSecond: 3, maxConcurrency: 2, forbiddenCategories: [], reviewState: 'OWNER_REVIEWED',
      sourceSnapshot: { url: null, rules: '', unrepresentedRules: ['Testing is permitted only during an approved window.'] },
    } } },
  } });
  const ready = await p.bountyProgram.create({ data: {
    ownerId, companyName: 'Orion — web campaign', platform: 'HACKERONE', requiredUserAgent: 'CampaignFixture/1',
    scopeAssets: { create: ['app.example.test', 'api.example.test'].map((host, i) => ({
      originalValue: host, normalizedValue: host, format: 'SUBDOMAIN', type: i ? 'API' : 'WEB_APPLICATION',
    })) },
  } });

  try {
    // The initial list and campaign markup arrive on the document response.
    const response = await page.goto(origin + '/targets');
    assert.match(await response.text(), /Orion/);
    const blockedRow = page.getByRole('row').filter({ hasText: blocked.companyName });
    const readyRow = page.getByRole('row').filter({ hasText: ready.companyName });
    assert.match(await blockedRow.innerText(), /Policy review needed[\s\S]*Target[\s\S]*Blocked/);
    assert.match(await readyRow.innerText(), /Recon[\s\S]*Not started/);
    await blockedRow.getByRole('link', { name: 'Open ' + blocked.companyName }).click();
    await primary('link', 'Fix policy').waitFor();
    await page.getByRole('status').filter({ hasText: 'Automation is blocked by unrepresented program or scope rules.' }).waitFor();
    await capture('blocked');
    await primary('link', 'Fix policy').click();
    await page.waitForURL(path(blocked.id) + '/settings#execution-policy');

    const readyResponse = await page.goto(path(ready.id));
    assert.match(await readyResponse.text(), /Start recon/);
    await primary('button', 'Start recon').waitFor();
    const idleRequestCount = requestPaths.length;
    await page.waitForTimeout(5600);
    assert.deepEqual(campaignRequests(idleRequestCount), [], 'idle campaign makes no background API requests');

    const start = page.waitForResponse(response => response.url() === origin + '/api/programs/' + ready.id + '/recon' && response.request().method() === 'POST');
    await primary('button', 'Start recon').click();
    assert.equal((await start).status(), 202);
    await primary('link', 'View progress').waitFor();
    await page.getByText('0/2 assets finished', { exact: true }).waitFor();
    await primary('link', 'View progress').click();
    await page.waitForURL(path(ready.id) + '#recon');

    const run = await p.targetReconRun.findFirstOrThrow({ where: { programId: ready.id }, include: { scans: true } });
    assert.equal(run.scans.length, 2);
    await p.$transaction([
      p.targetReconRun.update({ where: { id: run.id }, data: { status: 'RUNNING', startedAt: new Date() } }),
      p.scanRun.update({ where: { id: run.scans[0].id }, data: { status: 'COMPLETED', outcome: 'SUCCESS', finishedAt: new Date() } }),
    ]);
    await page.getByText('1/2 assets finished', { exact: true }).waitFor();
    assert(requestPaths.includes('/api/programs/campaign-stream'), 'active run uses a campaign stream');
    await capture('recon-running');

    await p.$transaction([
      p.scanRun.update({ where: { id: run.scans[1].id }, data: { status: 'COMPLETED', outcome: 'SUCCESS', finishedAt: new Date() } }),
      p.targetReconRun.update({ where: { id: run.id }, data: {
        status: 'COMPLETED', outcome: 'SUCCESS', finishedAt: new Date(), scopeMarkdown: 'Controlled Research handoff fixture.',
      } }),
    ]);
    await primary('link', 'Open research').waitFor();
    const afterRun = requestPaths.length;
    await page.waitForTimeout(5600);
    assert.deepEqual(campaignRequests(afterRun), [], 'terminal Recon stops background requests');
    await primary('link', 'Open research').click();
    await page.waitForURL(origin + '/research?program=' + ready.id);
    await page.getByRole('heading', { name: 'Research', exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: /^Open console/ }).count(), 0);
    await page.getByRole('link', { name: 'View details', exact: true }).click();
    await page.waitForURL(origin + '/research?program=' + ready.id + '&view=details');
    await page.getByRole('link', { name: /^Open console/ }).first().waitFor();

    const finding = await p.finding.create({ data: {
      targetId: run.scans[0].targetId, title: 'Unauthorized access to a fixture record', severity: 'HIGH',
      reviewStatus: 'CONFIRMED', gateStatus: 'PASSED', lifecycle: null, evidence: 'Controlled evidence for an owned record.',
    } });
    await page.goto(path(ready.id));
    await primary('link', 'View findings').waitFor();
    await capture('findings-present');
    await primary('link', 'View findings').click();
    await page.waitForURL(path(ready.id) + '/findings');
    await page.getByRole('link', { name: 'Open report', exact: true }).click();
    await page.waitForURL(path(ready.id) + '/report?finding=' + finding.id);
    await page.getByText('Confirmed findings · 1 selected', { exact: true }).waitFor();
    const wrongProgram = await context.request.get(path(blocked.id) + '/report?finding=' + finding.id);
    const wrongProgramHtml = await wrongProgram.text();
    assert.match(wrongProgramHtml, /This page could not be found|NEXT_HTTP_ERROR_FALLBACK;404/);
    assert(!wrongProgramHtml.includes(finding.title));

    const details = await page.goto(path(ready.id) + '/details');
    assert(details.ok());
    for (const label of ['Scope assets', 'Recon history', 'Research details', 'Hunt history']) {
      await page.getByRole('link', { name: label, exact: true }).waitFor();
    }
    await page.goto(origin + '/targets');
    const idleList = requestPaths.length;
    await page.waitForTimeout(5600);
    assert.deepEqual(campaignRequests(idleList), [], 'idle Targets list makes no background API requests');
    console.log('TARGET_CAMPAIGN: blocked, ready, active progress, Research, Findings, Report and idle network passed');
  } finally { page.off('request', onRequest); }
}
