// Browser acceptance against the disposable console harness's built web app.
// No worker/model execution is claimed by this UI-only fixture.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-chromium';
const app = process.env.TEST_APP_URL;
assert(app && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(app), 'An isolated local test app is required');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext(), page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const email = `workflow-${Date.now()}@example.test`, password = 'Disposable-Workflow-Test-123';
  const registration = await context.request.post(app + '/api/register', { data: { name: 'Target workflow fixture', email, password } });
  assert.equal(registration.status(), 200, await registration.text());
  await page.goto(app + '/login'); await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.waitForURL(app + '/targets');
  await page.getByRole('button', { name: 'Create target', exact: true }).click(); await page.getByLabel('Company / program name *', { exact: true }).fill('Console Target workflow'); await page.getByLabel(/^Required User-Agent/).fill('Target-Workflow/1'); await page.getByRole('button', { name: 'Create target', exact: true }).click(); await page.waitForURL(/\/targets\/[^/?]+$/);
  const id = new URL(page.url()).pathname.split('/').at(-1);
  await page.getByRole('button', { name: '+ Add asset', exact: true }).click(); await page.getByLabel('Asset', { exact: true }).fill('www\\.example.test'); await page.getByLabel('New asset value').selectOption('HIGH'); await page.getByRole('button', { name: 'Save asset', exact: true }).click();
  const row = page.locator('tbody tr').filter({ hasText: 'www.example.test' }); await row.waitFor(); assert.equal(await row.getByLabel('Value www.example.test').inputValue(),'HIGH');
  const changed=page.waitForResponse(r=>r.url().includes('/assets/')&&r.request().method()==='PATCH');await row.getByLabel('Type www.example.test').selectOption('API');assert.equal((await changed).status(),200);
  await page.getByRole('button',{name:'Recon',exact:true}).click();await row.getByRole('cell',{name:'Queued',exact:true}).waitFor();
  const response = await context.request.get(app + `/api/programs/${id}/scope.md`); assert.equal(response.status(), 200); assert((await response.text()).includes('LLM Safety Boundary'));
  await page.goto(app + `/recon?program=${id}`); await page.getByRole('heading',{name:'Recon history — Console Target workflow',exact:true}).waitFor();
  await page.setViewportSize({ width: 390, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert.deepEqual(errors, []);
  console.log('Target workflow passed: structured asset, escaping, value/type, Target-wide enqueue, scope.md, compatible Recon history link and mobile width.');
} finally { await browser.close(); }
