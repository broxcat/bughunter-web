import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), findFirst: vi.fn(), update: vi.fn(), info: vi.fn(), lookup: vi.fn(), mutateHost: vi.fn(), createScopeAsset: vi.fn() }));
vi.mock('@/server/programHosts', () => ({ mutateHost: mocks.mutateHost, hostErrorResponse: () => Response.json({}, { status: 500 }) }));
vi.mock('@/server/scopeAssets', () => ({ createScopeAsset: mocks.createScopeAsset, listScopeAssets: vi.fn(), listTargetAssets: vi.fn(), assetError: () => Response.json({}, { status: 500 }) }));
vi.mock('@/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/prisma', () => ({ prisma: { scope: { findFirst: mocks.findFirst, update: mocks.update } } }));
vi.mock('@/lib/logger', () => ({ logger: { info: mocks.info, warn: vi.fn(), error: vi.fn() } }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
import { assertPublicScopeValues, ScopeAdmissionError } from '@/server/scopeAdmission';
import { POST as approve } from '@/app/api/scopes/[id]/approve/route';
import { POST as addHost } from '@/app/api/programs/[id]/hosts/route';
import { POST as addAsset } from '@/app/api/programs/[id]/assets/route';

const answers: Record<string, string[]> = { 'internal.attacker.example': ['10.0.0.5'], 'meta.attacker.example': ['169.254.169.254'], 'tail.attacker.example': ['100.101.102.103'],
  'attacker.example': ['127.0.0.1'], 'public.example': ['93.184.216.34'], 'mixed.example': ['93.184.216.34', '192.168.1.1'] };
const lookupAll = async (host: string) => { const list = answers[host]; if (!list) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }); return list.map(address => ({ address, family: 4 })); };
const request = (body: unknown, origin = 'http://app.test') => new Request('http://app.test/api/scopes/s1/approve', { method: 'POST', headers: { 'Content-Type': 'application/json', Host: 'app.test', Origin: origin }, body: JSON.stringify(body) });
const valid = { justification: 'HackerOne program https://hackerone.com/example scope page', attestation: true };

describe('scope admission (M2)', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('refuses executable entries that resolve to private, tailnet, metadata or loopback addresses', async () => {
    for (const value of ['internal.attacker.example', 'https://meta.attacker.example/app', '*.attacker.example', 'tail.attacker.example', 'mixed.example']) {
      await expect(assertPublicScopeValues([value], { lookupAll }), value).rejects.toBeInstanceOf(ScopeAdmissionError);
    }
  });
  it('admits public and not-yet-resolvable hosts, and documentation-only IP/CIDR entries', async () => {
    await expect(assertPublicScopeValues(['public.example', '*.public.example', 'https://public.example/api', 'not-registered.example', '10.0.0.0/8', '192.168.1.10'], { lookupAll })).resolves.toBeUndefined();
  });
  it('admits an exact operator lab host without DNS', async () => {
    vi.stubEnv('EGRESS_LAB_ALLOWLIST', 'internal.attacker.example:8443=10.0.0.5');
    const spy = vi.fn(lookupAll);
    await expect(assertPublicScopeValues(['internal.attacker.example'], { lookupAll: spy })).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('POST /api/scopes/[id]/approve (M2/B6)', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_URL', 'http://app.test');
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: 'owner' } });
    mocks.lookup.mockImplementation(lookupAll);
    mocks.update.mockImplementation(async ({ data }) => ({ id: 's1', ...data }));
  });
  const context = (id = 's1') => ({ params: Promise.resolve({ id }) });
  it('requires a justification and an explicit attestation before any state change', async () => {
    mocks.findFirst.mockResolvedValue({ id: 's1', userId: 'owner', hostPattern: 'public.example', status: 'PENDING' });
    for (const body of [undefined, {}, { justification: 'too short', attestation: true }, { justification: valid.justification }, { ...valid, attestation: 'yes' }, { ...valid, status: 'APPROVED' }]) {
      expect((await approve(request(body), context())).status).toBe(400);
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('records the justification and an audit event for a public scope', async () => {
    mocks.findFirst.mockResolvedValue({ id: 's1', userId: 'owner', hostPattern: 'public.example', status: 'PENDING' });
    const response = await approve(request(valid), context());
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 's1', userId: 'owner' }, data: { status: 'APPROVED', justification: valid.justification } });
    expect(mocks.info).toHaveBeenCalledWith(expect.objectContaining({ audit: 'scope.approved', scopeId: 's1', userId: 'owner' }), expect.any(String));
    expect(JSON.stringify(mocks.info.mock.calls)).not.toContain('hackerone.com/example');
  });
  it('refuses to approve a scope resolving to an internal address', async () => {
    mocks.findFirst.mockResolvedValue({ id: 's1', userId: 'owner', hostPattern: 'internal.attacker.example', status: 'PENDING' });
    const response = await approve(request(valid), context());
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/private, local or infrastructure/);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('rejects malformed identifiers, foreign origins and anonymous callers before the database', async () => {
    for (const id of ['../x', 'a b', "1' OR '1'='1", 'x'.repeat(129), '']) expect((await approve(request(valid), context(id))).status).toBe(404);
    expect((await approve(request(valid, 'http://evil.test'), context())).status).toBe(403);
    mocks.auth.mockResolvedValue(null);
    expect((await approve(request(valid), context())).status).toBe(401);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });
});

describe('host and asset admission routes (M2)', () => {
  beforeEach(() => { vi.stubEnv('AUTH_URL', 'http://app.test'); vi.resetAllMocks(); mocks.auth.mockResolvedValue({ user: { id: 'owner' } }); mocks.lookup.mockImplementation(lookupAll); mocks.mutateHost.mockResolvedValue({ id: 't' }); mocks.createScopeAsset.mockResolvedValue({ id: 'a' }); });
  const post = (body: unknown) => new Request('http://app.test/api/programs/p1/x', { method: 'POST', headers: { 'Content-Type': 'application/json', Host: 'app.test', Origin: 'http://app.test' }, body: JSON.stringify(body) });
  const context = { params: Promise.resolve({ id: 'p1' }) };
  it('refuses internal-resolving hosts and assets before any mutation, and admits public ones', async () => {
    expect((await addHost(post({ host: 'meta.attacker.example' }), context)).status).toBe(400);
    expect((await addAsset(post({ value: 'https://internal.attacker.example/' }), context)).status).toBe(400);
    expect(mocks.mutateHost).not.toHaveBeenCalled(); expect(mocks.createScopeAsset).not.toHaveBeenCalled();
    expect((await addHost(post({ host: 'public.example' }), context)).status).toBe(201);
    expect((await addAsset(post({ value: '*.public.example' }), context)).status).toBe(201);
  });
});
