import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyReconDelivery } from '@/lib/research/reconDelivery';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), fetch: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: mocks.auth }));
const db = process.env.TEST_DATABASE_URL, schema = `reconcontext_${randomUUID().replaceAll('-', '')}`;
if (db) { const url = new URL(db); url.searchParams.set('schema', schema); process.env.DATABASE_URL = url.toString(); }
let prisma: typeof import('@/lib/prisma').prisma;
let GET: typeof import('@/app/api/research-targets/[id]/recon/route').GET;
let POST: typeof import('@/app/api/research-targets/[id]/recon/route').POST;
let root: string, userId: string, otherId: string, targetId: string, publicKey: string;
const params = () => ({ params: Promise.resolve({ id: targetId }) });
const get = (query = '') => GET(new Request(`http://app.example.test/api/research-targets/${targetId}/recon${query}`), params());
const post = (body: unknown, origin = 'http://app.example.test') => POST(new Request(`http://app.example.test/api/research-targets/${targetId}/recon`, { method: 'POST', headers: { Origin: origin }, body: JSON.stringify(body) }), params());
(db ? describe : describe.skip)('persistent Recon snapshots and provider delivery API with PostgreSQL', () => {
  beforeAll(async () => {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
    ({ prisma } = await import('@/lib/prisma'));
    ({ GET, POST } = await import('@/app/api/research-targets/[id]/recon/route'));
    root = await mkdtemp(join(tmpdir(), 'research-recon-api-')); process.env.RESEARCH_CONSOLE_ROOT = root; process.env.AUTH_URL = 'http://app.example.test';
    const keys = generateKeyPairSync('ed25519'); publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    process.env.RESEARCH_TERMINAL_PRIVATE_KEY_FILE = join(root, 'private.pem');
    await writeFile(process.env.RESEARCH_TERMINAL_PRIVATE_KEY_FILE, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    otherId = (await prisma.user.create({ data: { email: `${randomUUID()}@example.test` } })).id;
    vi.stubGlobal('fetch', mocks.fetch);
  }, 30000);
  beforeEach(async () => {
    userId = (await prisma.user.create({ data: { email: `${randomUUID()}@example.test` } })).id;
    const scope = await prisma.scope.create({ data: { userId, hostPattern: 'app.example.test', status: 'APPROVED' } });
    const program = await prisma.bountyProgram.create({ data: { ownerId: userId, companyName: 'Recon fixture', requiredUserAgent: 'Recon/1', scopeRules: ['*.example.test'] } });
    targetId = (await prisma.target.create({ data: { userId, scopeId: scope.id, programId: program.id, host: 'app.example.test' } })).id;
    mocks.auth.mockResolvedValue({ user: { id: userId } }); mocks.fetch.mockReset();
    mocks.fetch.mockImplementation(async (_url, options) => {
      const claims = verifyReconDelivery(options.headers.Authorization.slice(7), publicKey);
      return new Response(JSON.stringify({ status: 'STAGED', provider: claims.provider, contentSha256: claims.contentSha256 }));
    });
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    if (prisma) { await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); await prisma.$disconnect(); }
    if (root) await rm(root, { recursive: true, force: true });
  });
  const scan = async () => {
    const { researchRecon } = await import('../fixtures/research');
    return prisma.scanRun.create({ data: { targetId, type: 'RECON', status: 'COMPLETED', outcome: 'SUCCESS', startedAt: new Date(), finishedAt: new Date(), reconCorpus: researchRecon().reconCorpus } });
  };
  it('generates deterministic, canonical artifacts from actual SQL data and reuses identical snapshots', async () => {
    const original = await scan(), before = await prisma.scanRun.findUniqueOrThrow({ where: { id: original.id } });
    expect(await (await get()).json()).toMatchObject({ snapshot: null });
    const response = await post({ action: 'generate' }); expect(response.status).toBe(200); const first = await response.json();
    expect(first.snapshot.context.sources.some((s: { scanId: string }) => s.scanId === original.id)).toBe(true);
    const details = await (await get(`?snapshotId=${first.snapshot.id}&kind=endpoints&page=0`)).json(); expect(details.items.length).toBeGreaterThan(0);
    const file = join(root, `research_${targetId}`, 'recon', `snapshot-${first.snapshot.contentSha256}.json`), text = await readFile(file, 'utf8');
    const second = await (await post({ action: 'generate' })).json(); expect(second.snapshot).toEqual(first.snapshot);
    expect(await prisma.researchReconSnapshot.count({ where: { sessionId: first.sessionId } })).toBe(1);
    expect(await readFile(file, 'utf8')).toBe(text); expect(await prisma.scanRun.findUniqueOrThrow({ where: { id: original.id } })).toEqual(before);
  });
  it('detects new Recon without silently replacing delivered evidence, then explicitly publishes another version', async () => {
    await scan(); const first = await (await post({ action: 'generate' })).json();
    expect((await post({ action: 'transmit', snapshotId: first.snapshot.id, provider: 'codex' })).status).toBe(200);
    const oldFile = join(root, `research_${targetId}/recon/snapshot-${first.snapshot.contentSha256}.json`), oldText = await readFile(oldFile, 'utf8');
    const next = await scan(); await prisma.scanRun.update({ where: { id: next.id }, data: { status: 'FAILED', outcome: 'PARTIAL' } });
    const available = await (await get()).json(); expect(available).toMatchObject({ updateAvailable: true, snapshot: { id: first.snapshot.id } });
    expect(available.deliveries[0]).toMatchObject({ snapshotId: first.snapshot.id, provider: 'codex', status: 'STAGED' });
    const second = await (await post({ action: 'generate' })).json(); expect(second.snapshot.id).not.toBe(first.snapshot.id); expect(second.updateAvailable).toBe(false);
    expect(await readFile(oldFile, 'utf8')).toBe(oldText); expect(second.deliveries[0].snapshotId).toBe(first.snapshot.id);
  });
  it.each(['codex', 'claude'] as const)('transmits the same immutable base to %s using a signed, provider-bound control request', async provider => {
    await scan(); const first = await (await post({ action: 'generate' })).json();
    const response = await post({ action: 'transmit', snapshotId: first.snapshot.id, provider }); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ snapshotId: first.snapshot.id, provider, status: 'STAGED' });
    const [url, options] = mocks.fetch.mock.calls[0]; expect(url.pathname).toBe('/control/recon');
    const claims = verifyReconDelivery(options.headers.Authorization.slice(7), publicKey);
    expect(claims).toMatchObject({ provider, targetId, sessionId: first.sessionId, contentSha256: first.snapshot.contentSha256 });
    expect(JSON.stringify(mocks.fetch.mock.calls)).not.toMatch(/cookie|password|config\.toml|PRIVATE/);
  });
  it('records uncertain delivery without retrying or claiming model consumption', async () => {
    const first = await (await post({ action: 'generate' })).json(); mocks.fetch.mockRejectedValue(new Error('Timeout'));
    expect(await (await post({ action: 'transmit', snapshotId: first.snapshot.id, provider: 'codex' })).json()).toMatchObject({ status: 'UNKNOWN' });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it('requires the acknowledgement to identify the selected provider and snapshot', async () => {
    const first = await (await post({ action: 'generate' })).json();
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ status: 'STAGED', provider: 'claude', contentSha256: 'f'.repeat(64) })));
    expect(await (await post({ action: 'transmit', snapshotId: first.snapshot.id, provider: 'codex' })).json()).toMatchObject({ status: 'UNKNOWN' });
  });
  it('preserves historical Research sessions and their immutable initial export fields', async () => {
    const legacy = await prisma.researchSession.create({ data: { userId, targetId, workspaceId: randomUUID(), status: 'READY', targetHost: 'app.example.test', programName: 'Legacy', scopeMarkdown: 'Historical scope', files: ['AGENTS.md'], exportSha256: 'a'.repeat(64) } });
    await scan(); await post({ action: 'generate' });
    expect(await prisma.researchSession.findUniqueOrThrow({ where: { id: legacy.id } })).toEqual(legacy);
    expect(await prisma.researchReconSnapshot.count({ where: { sessionId: legacy.id } })).toBe(0);
  });
  it('requires ownership/authentication, bounds input and refuses foreign origins/commands', async () => {
    const first = await (await post({ action: 'generate' })).json();
    expect((await post({ action: 'generate' }, 'https://foreign.example.test')).status).toBe(403);
    for (const body of [{ action: 'generate', command: 'sh' }, { action: 'transmit', snapshotId: first.snapshot.id, provider: 'shell' }, { action: 'generate', text: 'a'.repeat(1000) }]) expect((await post(body)).status).toBe(400);
    mocks.auth.mockResolvedValue({ user: { id: otherId } });
    expect((await get()).status).toBe(404); expect((await get(`?snapshotId=${first.snapshot.id}&kind=sources`)).status).toBe(404); expect((await post({ action: 'generate' })).status).toBe(404);
    mocks.auth.mockResolvedValue(null); expect((await get()).status).toBe(401); expect((await post({ action: 'generate' })).status).toBe(401);
  });
  it('refuses revoked or drifted authorization before delivering or regenerating', async () => {
    const first = await (await post({ action: 'generate' })).json(), target = await prisma.target.findUniqueOrThrow({ where: { id: targetId } });
    await prisma.scope.update({ where: { id: target.scopeId }, data: { rulesOfEngagement: 'Changed policy' } });
    expect((await post({ action: 'transmit', snapshotId: first.snapshot.id, provider: 'claude' })).status).toBe(409);
    expect((await post({ action: 'generate' })).status).toBe(409); expect(mocks.fetch).not.toHaveBeenCalled();
    await prisma.scope.update({ where: { id: target.scopeId }, data: { status: 'REVOKED' } });
    expect((await post({ action: 'transmit', snapshotId: first.snapshot.id, provider: 'codex' })).status).toBe(400);
  });
});
