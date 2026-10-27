// Explicit operator smoke against the locally configured FINAL image/DB only.
// All browser traffic is relayed to this container's loopback web. No bounty target.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { chromium } from 'playwright-chromium';
import { loopHypothesis } from '../fixtures/researchLoop.mjs';
import { fakeBurp } from '../research/fakeBurp.mjs';
import { BurpResearch } from '../../docker/research/validator/burp-service.mjs';
import { withBurp } from '../../docker/research/validator/burp-upstream.mjs';
assert.equal(process.env.BH_FINAL_STACK_SMOKE, '1', 'Explicit local final-stack smoke opt-in required');
assert.equal(new URL(process.env.DATABASE_URL).hostname, 'db', 'Only the local Compose database is permitted');
const root = process.env.RESEARCH_WORKSPACE_ROOT;
assert.equal(root, '/research-workspaces');
const origin = new URL(process.env.AUTH_URL).origin, internal = 'http://127.0.0.1:3000';
const prisma = new PrismaClient(), workspaces = [], sentinels = ['FINAL_RAW_COOKIE', 'FINAL_RAW_BEARER', 'FINAL_RAW_PASSWORD', 'FINAL_RAW_API_KEY', 'FINAL_RAW_CIPHERTEXT'];
const sensitive = [...sentinels, ...['AUTH_SECRET', 'CREDENTIALS_ENCRYPTION_KEY', 'DATABASE_URL'].map(k => process.env[k]).filter(v => v && v.length >= 20)];
const clean = value => { const text = typeof value === 'string' ? value : JSON.stringify(value); for (const secret of sensitive) assert(!text.includes(secret), 'Sensitive data appeared in a smoke-test output'); };
let user, browser, fixture, context;
const fingerprint = async () => createHash('sha256').update(JSON.stringify(await prisma.finding.findMany({ select: { id: true, reviewStatus: true, gateStatus: true, updatedAt: true }, orderBy: { id: 'asc' } }))).update(JSON.stringify(await prisma.report.findMany({ select: { id: true, updatedAt: true }, orderBy: { id: 'asc' } }))).digest('hex');
const before = await fingerprint();
try {
  const health = await (await fetch(internal + '/api/health')).json(); assert.deepEqual(health, { status: 'ok', db: 'up', redis: 'up' });
  const password = randomUUID();
  user = await prisma.user.create({ data: { email: `final-research-${randomUUID()}@example.test`, passwordHash: await bcrypt.hash(password, 10) } });
  const program = await prisma.bountyProgram.create({ data: { ownerId: user.id, companyName: 'Disposable final Research smoke', requiredUserAgent: 'Research-Test/1' } });
  const scope = await prisma.scope.create({ data: { userId: user.id, hostPattern: 'app.example.test', status: 'APPROVED' } });
  const target = await prisma.target.create({ data: { userId: user.id, programId: program.id, scopeId: scope.id, host: 'app.example.test' } });
  await prisma.targetCredential.create({ data: { targetId: target.id, label: 'Synthetic context; never decrypted', cookiesCipher: sentinels[4] } });
  await prisma.aiProviderConfig.create({ data: { userId: user.id, provider: 'OPENAI', apiKeyCipher: sentinels[4] } });
  // Labelled stored Recon fixture. Real local tool/worker checks run separately.
  const recon = await prisma.scanRun.create({ data: { targetId: target.id, type: 'RECON', status: 'COMPLETED', outcome: 'SUCCESS', reconCorpus: { version: 1, capturedAt: new Date().toISOString(), urls: ['https://app.example.test/objects/fixture'], authenticated: false, surface: Object.fromEntries(['queryInputs','objectReferences','forms','javascript','cookies','jwt','oauth','xml','urlInputs','fileInputs','businessFlows','apiEndpoints'].map(k => [k, false])) } } });
  const legacyId = randomUUID(); workspaces.push(legacyId);
  await mkdir(join(root, legacyId, 'research'), { recursive: true, mode: 0o750 });
  await writeFile(join(root, legacyId, 'scope.md'), 'Synthetic legacy authorized host: app.example.test');
  await writeFile(join(root, legacyId, 'research/hypotheses.md'), '# Legacy fixture hypotheses\nNo structured proof supplied.');
  const legacy = await prisma.researchSession.create({ data: { userId: user.id, targetId: target.id, workspaceId: legacyId, status: 'READY', targetHost: target.host, programName: program.companyName, scopeMarkdown: 'Synthetic legacy authorization snapshot', files: ['scope.md','research/hypotheses.md'] } });
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  context = await browser.newContext({ serviceWorkers: 'block' });
  const hops = Math.max(1, Math.min(16, Number(process.env.TRUSTED_PROXY_HOPS) || 1));
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { await route.abort(); return; }
    const response = await route.fetch({ url: internal + url.pathname + url.search, maxRedirects: 0, headers: { ...(await route.request().allHeaders()), host: new URL(origin).host, 'x-forwarded-host': new URL(origin).host, 'x-forwarded-proto': new URL(origin).protocol.slice(0, -1), 'x-forwarded-for': Array(hops).fill('127.0.0.1').join(', ') } });
    await route.fulfill({ response });
  });
  const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.name));
  const api = (path, data, method = 'POST') => page.evaluate(async ({ path, data, method }) => {
    const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, body: await response.json() };
  }, { path, data, method });
  await page.goto(origin + '/login'); await page.getByLabel('Email', { exact: true }).fill(user.email); await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.waitForURL(origin + '/targets');
  await page.goto(origin + `/targets/${program.id}`); await page.getByRole('heading', { name: program.companyName, exact: true }).waitFor();
  await page.goto(origin + `/recon?program=${program.id}`); await page.getByRole('heading', { name: /Recon/ }).first().waitFor();
  await page.goto(origin + `/research/${legacy.id}`); await page.getByText('Status: READY', { exact: true }).waitFor();
  assert.equal((await api(`/api/research-sessions/${legacy.id}`, undefined, 'GET')).status, 200);
  await page.goto(origin + '/research');
  const creating = page.waitForResponse(r => new URL(r.url()).pathname === '/api/research-sessions' && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create Research Workspace', exact: true }).click();
  const created = await creating; assert.equal(created.status(), 201); const session = await created.json(); clean(session); workspaces.push(session.workspaceId);
  await page.waitForURL(origin + `/research/${session.id}`); assert.equal(session.reconScanRunId, recon.id);
  const path = join(root, session.workspaceId);
  for (const filename of session.files) clean(await readFile(join(path, filename), 'utf8'));
  const instructions = await readFile(join(path, 'AGENTS.md'), 'utf8'); assert(instructions.includes('UNTRUSTED DATA')); assert(instructions.includes('negative control')); assert(instructions.includes('User-Agent'));
  await page.getByRole('button', { name: 'Refresh last diagnostic', exact: true }).click(); await page.getByText('Burp MCP: unavailable / not checked', { exact: true }).waitFor();
  fixture = await fakeBurp();
  const policy = JSON.parse(await readFile(join(path, 'burp-policy.json'), 'utf8'));
  const burp = new BurpResearch(policy, (action, timeout) => withBurp(action, timeout, `http://127.0.0.1:${fixture.port}/`));
  const history = await burp.history(2, 0), evidence = burp.evidence(history.items[0].observationId); clean(evidence); assert.equal(evidence.networkDestinationVerified, false);
  // Fixed fixture artifact in this server-generated workspace; no browser path input.
  const burpRef = 'evidence/burp/final-fixture.json'; await writeFile(join(path, burpRef), JSON.stringify(evidence));
  for (const name of ['positive','control']) await writeFile(join(path, `evidence/${name}.txt`), 'Synthetic local capture\nCookie: FINAL_RAW_COOKIE\nAuthorization: Bearer FINAL_RAW_BEARER\npassword=FINAL_RAW_PASSWORD');
  const initial = loopHypothesis({ targetId: target.id }); initial.initialObservations[0].source = 'BURP_MCP'; initial.initialObservations[0].evidence = [{ ref: burpRef, summary: 'Passive fixture metadata; actual network destination remains unverified.' }];
  const sync = async hypotheses => {
    await writeFile(join(path, 'research/hypotheses.json'), JSON.stringify({ version: 2, sessionId: session.id, hypotheses }));
    const result = await api(`/api/research-sessions/${session.id}/hypotheses/sync`); assert.equal(result.status, 200); clean(result.body); await page.reload();
  };
  await sync([initial]);
  const rejected = loopHypothesis({ targetId: target.id, status: 'REJECTED' }); await sync([rejected]); await sync([]);
  assert.equal((await prisma.researchHypothesis.findFirstOrThrow({ where: { sessionId: session.id, externalId: 'H-001' } })).status, 'REJECTED');
  const candidates = ['OPEN','TESTING','BLOCKED'].map((status, i) => ({ ...loopHypothesis({ targetId: target.id, status }), externalId: `H-00${i + 3}` }));
  const confirmed = { ...loopHypothesis({ targetId: target.id, status: 'CONFIRMED' }), externalId: 'H-002' };
  confirmed.initialObservations[0].source = 'BURP_MCP'; confirmed.initialObservations[0].evidence = [{ ref: burpRef, summary: 'Initial passive fixture observation, independently reproduced with explicit direct positive and negative captures.' }];
  confirmed.reasoning += '\nCookie: FINAL_RAW_COOKIE\nAuthorization: Bearer FINAL_RAW_BEARER\napi_key=FINAL_RAW_API_KEY';
  await sync([confirmed, ...candidates]);
  const rows = await prisma.researchHypothesis.findMany({ where: { sessionId: session.id } }); clean(rows);
  for (const h of rows.filter(h => h.status !== 'CONFIRMED')) assert.equal((await api(`/api/research-sessions/${session.id}/hypotheses/${h.id}/finding-draft`, { expectedRevision: h.revision, acknowledgeHumanReview: true })).status, 409);
  assert.equal(await prisma.finding.count({ where: { targetId: target.id } }), 0);
  await page.getByRole('link', { name: 'View details — H-002', exact: true }).click(); clean(await page.locator('body').innerText());
  await page.getByRole('checkbox', { name: /I reviewed this revision/ }).check();
  const promoting = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/finding-draft'));
  await page.getByRole('button', { name: 'Create Finding Draft', exact: true }).evaluate(button => { button.click(); button.click(); });
  const promotedResponse = await promoting; assert.equal(promotedResponse.status(), 201); const promoted = await promotedResponse.json(); clean(promoted);
  const h = rows.find(h => h.status === 'CONFIRMED');
  const retry = await api(`/api/research-sessions/${session.id}/hypotheses/${h.id}/finding-draft`, { expectedRevision: h.revision, acknowledgeHumanReview: true }); assert.equal(retry.status, 200); assert.equal(retry.body.findingId, promoted.findingId);
  const draft = await prisma.finding.findUniqueOrThrow({ where: { id: promoted.findingId } }); clean(draft);
  assert.equal(draft.reviewStatus, 'CANDIDATE'); assert.equal(draft.gateStatus, 'UNVALIDATED'); assert.equal(draft.severity, 'INFO');
  const reportData = { title: 'Explicit disposable final report', platform: 'GENERIC', findingIds: [draft.id] };
  assert.equal((await api('/api/reports', reportData)).status, 400); assert.equal(await prisma.report.count({ where: { userId: user.id } }), 0);
  await page.reload(); await page.getByRole('link', { name: 'Open Finding draft', exact: true }).click();
  const card = page.locator(`#finding-${draft.id}`); await card.getByRole('button', { name: 'Review evidence', exact: true }).click();
  await card.getByLabel('Reproduction and impact', { exact: true }).fill('Operator independently inspected the synthetic captures, reproduced the controlled ownership effect and assessed scope, controls and impact.');
  await card.getByRole('button', { name: 'Confirm', exact: true }).click(); await card.getByText('CONFIRMED', { exact: true }).waitFor();
  assert.equal(await prisma.report.count({ where: { userId: user.id } }), 0);
  await page.goto(origin + `/targets/${target.id}/report`); await page.getByRole('checkbox').check();
  await page.getByLabel('Report title', { exact: true }).fill(reportData.title); await page.getByLabel('Report platform', { exact: true }).selectOption('GENERIC');
  await page.getByRole('button', { name: 'Generate report', exact: true }).click(); await page.getByRole('heading', { name: 'Generated markdown', exact: true }).waitFor();
  await page.reload(); await page.getByRole('combobox', { name: 'Saved report', exact: true }).waitFor(); clean(await page.locator('body').innerText());
  const manual = await api('/api/findings', { targetId: target.id, title: 'Independent manual fixture', evidence: 'Synthetic manually captured fixture evidence.' }); assert.equal(manual.status, 201); assert.equal(manual.body.gateStatus, 'UNVALIDATED');
  const hunt = await prisma.scanRun.create({ data: { targetId: target.id, type: 'HUNT', status: 'COMPLETED', huntReport: { version: 1, legacyEvidence: 'Synthetic legacy fixture only' } } });
  await page.goto(origin + `/hunt/${hunt.id}`); await page.getByText(/This scan was produced by the retired/).waitFor();
  assert.equal((await api('/api/scan-runs', { targetId: target.id, type: 'HUNT' })).status, 410);
  assert.equal(await page.getByRole('button', { name: /Start Hunt|Run hunt/ }).count(), 0); assert.deepEqual(errors, []);
  console.log('FINAL_STACK_SMOKE PASSED: actual image/auth/DB, legacy and new workspace, Recon fixture, optional Burp absence, local MCP observation, retained falsification, controlled confirmation, explicit idempotent draft, independent human Evidence Review, explicit Report/manual Finding and legacy Hunt. Burp: PROTOCOL_VERIFIED only.');
} finally {
  await context?.unrouteAll({ behavior: 'ignoreErrors' });
  await browser?.close(); await fixture?.close();
  if (user) {
    const owned = await prisma.researchSession.findMany({ where: { userId: user.id }, select: { workspaceId: true } });
    for (const row of owned) if (!workspaces.includes(row.workspaceId)) workspaces.push(row.workspaceId);
    await prisma.researchFindingPromotion.deleteMany({ where: { userId: user.id } });
    await prisma.researchSession.deleteMany({ where: { userId: user.id } });
    await prisma.report.deleteMany({ where: { userId: user.id } });
    await prisma.target.deleteMany({ where: { userId: user.id } });
    await prisma.bountyProgram.deleteMany({ where: { ownerId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  for (const id of workspaces) { assert(/^[a-f0-9-]{36}$/.test(id)); await rm(join(root, id), { recursive: true, force: true }); await rm(join(root, '.exports', `${id}.zip`), { force: true }); }
  assert.equal(await fingerprint(), before, 'Pre-existing Findings/Reports changed during final smoke');
  await prisma.$disconnect();
}
