import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptSecret } from '@/lib/crypto';
import { DELETE, GET, PUT } from '@/app/api/settings/platform-connections/route';
import { POST } from '@/app/api/programs/import-preview/route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findMany: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
  preview: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  platformConnection: { findMany: mocks.findMany, upsert: mocks.upsert, deleteMany: mocks.deleteMany },
} }));
vi.mock('@/server/programImport/preview', () => ({ previewProgram: mocks.preview }));

function request(method: string, data: unknown, origin = 'https://bughunter.test') {
  return new Request('https://bughunter.test/api/settings/platform-connections', {
    method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'owner' } });
});
afterEach(() => vi.unstubAllEnvs());

describe('platform connection endpoints', () => {
  it('stores an encrypted token for the current account and returns only connection status', async () => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '2'.repeat(64));
    const credential = { platform: 'BUGCROWD', username: 'fixture-id', token: 'fixture-token' };
    const response = await PUT(request('PUT', credential));
    expect(await response.json()).toEqual({ platform: 'BUGCROWD' });
    const mutation = mocks.upsert.mock.calls[0][0];
    expect(mutation.where).toEqual({ userId_platform: { userId: 'owner', platform: 'BUGCROWD' } });
    const ciphertext = mutation.create.credentialCipher;
    expect(ciphertext).not.toContain(credential.token);
    expect(JSON.parse(decryptSecret(ciphertext))).toEqual(credential);

    mocks.findMany.mockResolvedValue([{ platform: 'BUGCROWD' }]);
    const list = await GET();
    expect(list.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await list.json()).toEqual({ connections: [{ platform: 'BUGCROWD' }] });
    expect(mocks.findMany).toHaveBeenCalledWith({ where: { userId: 'owner' }, select: { platform: true }, orderBy: { platform: 'asc' } });

    const removed = await DELETE(request('DELETE', { platform: 'BUGCROWD' }));
    expect(removed.status).toBe(204);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { userId: 'owner', platform: 'BUGCROWD' } });
  });

  it('rejects unauthenticated and cross-origin writes', async () => {
    expect((await PUT(request('PUT', { platform: 'INTIGRITI', token: 'fixture' }, 'https://elsewhere.test'))).status).toBe(403);
    mocks.auth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect((await DELETE(request('DELETE', { platform: 'INTIGRITI' }))).status).toBe(401);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});

describe('preview endpoint', () => {
  it('scopes preview credentials to the signed-in owner and makes no database writes', async () => {
    const input = { url: 'https://yeswehack.com/programs/example-program', platform: 'YESWEHACK' };
    mocks.preview.mockResolvedValue({ policy: { reviewState: 'IMPORT_DRAFT', automationAllowed: false } });
    const response = await POST(request('POST', input));
    expect(await response.json()).toMatchObject({ status: 'PREVIEW', preview: { policy: { reviewState: 'IMPORT_DRAFT' } } });
    expect(mocks.preview).toHaveBeenCalledWith('owner', expect.objectContaining(input));
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it('short-circuits manual-only platforms', async () => {
    const response = await POST(request('POST', { url: 'https://yeswehack.com/programs/example-program', platform: 'PRIVATE' }));
    expect(await response.json()).toEqual({ status: 'MANUAL', reason: 'manual' });
    expect(mocks.preview).not.toHaveBeenCalled();
  });
});
