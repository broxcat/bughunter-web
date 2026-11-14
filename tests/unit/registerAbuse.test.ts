import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ limit: vi.fn(), find: vi.fn(), create: vi.fn(), hash: vi.fn() }));
vi.mock('@/lib/rateLimit', () => ({ rateLimit: mocks.limit }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.find, create: mocks.create } } }));
vi.mock('bcryptjs', () => ({ default: { hash: mocks.hash } }));
import { POST } from '@/app/api/register/route';
import { RATE_LIMIT_POLICIES } from '@/lib/abusePolicy';

const body = JSON.stringify({ name: 'Fixture', email: 'new@example.test', password: 'valid-fixture-password' });
const req = (headers: Record<string, string> = {}, payload = body) => new Request('https://app.test/api/register', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://app.test', ...headers }, body: payload });

describe('registration abuse controls (B3)', () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.stubEnv('ALLOW_PUBLIC_REGISTRATION', 'true'); vi.stubEnv('TRUST_PROXY_HEADERS', 'false');
    mocks.limit.mockResolvedValue({ status: 'ALLOWED', remaining: 4, resetSec: 3600 }); mocks.hash.mockResolvedValue('hash'); mocks.find.mockResolvedValue(null); mocks.create.mockResolvedValue({ id: 'u' });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('applies per-client and global windows before any bcrypt work', async () => {
    expect((await POST(req())).status).toBe(200);
    expect(mocks.limit).toHaveBeenCalledWith('rl:register:ip:unknown', RATE_LIMIT_POLICIES.registerIp.limit, RATE_LIMIT_POLICIES.registerIp.windowSec);
    expect(mocks.limit).toHaveBeenCalledWith('rl:register:global', RATE_LIMIT_POLICIES.registerGlobal.limit, RATE_LIMIT_POLICIES.registerGlobal.windowSec);
    mocks.hash.mockClear();
    mocks.limit.mockResolvedValueOnce({ status: 'BLOCKED', remaining: 0, resetSec: 1234 });
    const limited = await POST(req());
    expect(limited.status).toBe(429); expect(limited.headers.get('Retry-After')).toBe('1234');
    expect(mocks.hash).not.toHaveBeenCalled(); expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it('fails closed when the limiter is unavailable', async () => {
    mocks.limit.mockResolvedValue({ status: 'UNAVAILABLE' });
    expect((await POST(req())).status).toBe(503);
    expect(mocks.hash).not.toHaveBeenCalled();
  });
  it('refuses cross-site or Origin-less submissions and oversized or unexpected bodies', async () => {
    expect((await POST(req({ origin: 'https://evil.test' }))).status).toBe(403);
    expect((await POST(new Request('https://app.test/api/register', { method: 'POST', body }))).status).toBe(403);
    expect((await POST(req({}, JSON.stringify({ name: 'x', email: 'a@b.test', password: 'p'.repeat(5000) })))).status).toBe(413);
    expect((await POST(req({}, JSON.stringify({ name: 'x', email: 'a@b.test', password: 'valid-fixture-password', admin: true })))).status).toBe(400);
    expect(mocks.hash).not.toHaveBeenCalled();
  });
  it('stays closed when public registration is disabled', async () => {
    vi.stubEnv('ALLOW_PUBLIC_REGISTRATION', 'false');
    expect((await POST(req())).status).toBe(403);
    expect(mocks.limit).not.toHaveBeenCalled();
  });
});
