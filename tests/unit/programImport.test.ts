import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectProgram, readProgramPreview } from '@/server/programImport/preview';
import { platformReader } from '@/server/programImport/transport';
import h1 from '../fixtures/program-import/hackerone.json';
import bc from '../fixtures/program-import/bugcrowd.json';
import int from '../fixtures/program-import/intigriti.json';
import ywh from '../fixtures/program-import/yeswehack.json';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  eval: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
  removeAllListeners: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: { platformConnection: { findUnique: mocks.findUnique } } }));
vi.mock('@/server/queue/connection', () => ({ createRedisConnection: () => mocks }));

const base = '/v1/hackers/programs/example-program';
const scopes = base + '/structured_scopes?page%5Bsize%5D=100&page%5Bnumber%5D=1';
function fixtureReader(records: Record<string, unknown>) {
  return vi.fn(async (path: string) => {
    if (!Object.hasOwn(records, path)) throw new Error('Unexpected request to ' + path);
    return records[path];
  });
}
const h1Reader = (scope = h1.scope) => fixtureReader({
  [base]: h1.program, [scopes]: scope,
  [base + '/scope_exclusions']: h1.rules,
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('read-only program import previews', () => {
  it('restricts HackerOne scope and produces a stable draft with source rules', async () => {
    const preview = await readProgramPreview(h1.url, h1Reader());
    expect(preview.scopeIn.map(asset => asset.normalizedValue)).toEqual(['https://ok.example.test/']);
    expect(preview.scopeOut.map(asset => asset.ref)).toEqual(['4', '7']);
    expect(preview.nonAutomatable[0].originalValue).toBe('123456789');
    expect(preview.unrepresentedAssets.map(asset => asset.ref)).toEqual(['1', '2', '3', '5', '9']);
    expect(preview.unrepresentedRules).toContainEqual({ assetRef: '5', text: 'Use only accounts you own.' });
    expect(preview.policy).toMatchObject({
      automationAllowed: true,
      exclusions: ['https://app.example.test/', 'https://example.test/admin/*'],
      requiredHeaders: [], requiredUserAgent: null, requestsPerSecond: null,
    });
    expect(await readProgramPreview(h1.url, h1Reader({ data: h1.scope.data.toReversed() }))).toEqual(preview);
  });

  it('uses the authenticated Bugcrowd catalog for invitations and preserves target-specific VRT rules', async () => {
    const read = fixtureReader({
      '/v1/engagements?limit=100&offset=0': bc.programs,
      ['/v1/engagements/' + bc.scope.engagement_id + '/scope']: bc.scope,
    });
    const preview = await readProgramPreview(bc.url, read);
    expect(read.mock.calls[0]).toEqual(['/v1/engagements?limit=100&offset=0']);
    expect(preview.scopeIn[0].normalizedValue).toBe('https://api.example.test/');
    expect(preview.nonAutomatable[0].originalValue).toBe('com.example.app');
    expect(preview.scopeOut[0].normalizedValue).toBe('https://excluded.example.test/');
    expect(preview.unrepresentedRules).toContainEqual({
      assetRef: bc.scope.in_scope[0].id, text: expect.stringContaining('example-category'),
    });
  });

  it('uses the Intigriti authorized catalog for a private program and retains rule prose', async () => {
    const program = { ...int.program, confidentialityLevel: { id: 1, value: 'Invite only' } };
    const read = fixtureReader({
      '/external/researcher/v1/programs?limit=500&offset=0': { maxCount: 1, records: [program] },
      ['/external/researcher/v1/programs/' + program.id]: program,
    });
    const preview = await readProgramPreview(int.url, read);
    expect(preview.scopeIn[0].normalizedValue).toBe('https://example.test/');
    expect(preview.unrepresentedAssets[0].sourceType).toBe('Other');
    expect(preview.policy.sourceSnapshot.rules).toContain('User-Agent: Researcher identity');
    expect(preview.policy.requiredUserAgent).toBeNull();
  });

  it('preserves YesWeHack prose exclusions and reward eligibility separately from scope-in', async () => {
    const read = fixtureReader({ '/programs/example-program': { ...ywh.program, non_qualifying_vulnerability: ['SQL injection', 'Reflected XSS on logout', ...ywh.program.non_qualifying_vulnerability] } });
    const preview = await readProgramPreview(ywh.url, read);
    expect(preview.scopeIn).toHaveLength(2);
    expect(preview.scopeOut[0].originalValue).toBe(ywh.program.out_of_scope[0]);
    expect(preview.policy.exclusions).toEqual([]);
    expect(preview.nonQualifying).toEqual(['SQL_INJECTION']);
    expect(preview.policy.sourceSnapshot.rules).toContain('Reflected XSS on logout');
    expect(preview.policy.sourceSnapshot.rules).toContain('Non-qualifying vulnerability:');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('makes no requests for foreign or malformed program URLs', async () => {
    const read = vi.fn();
    for (const url of ['https://example.test/example-program', 'https://hackerone.com.evil.test/example-program',
      'https://hackerone.com/example-program/../security', 'https://hackerone.com/%73ecurity',
      'https://hackerone.com@internal.test/example-program', 'https://999.999.999.999/test']) {
      expect(detectProgram(url)).toBeNull();
      await expect(readProgramPreview(url, read)).rejects.toMatchObject({ reason: 'manual' });
    }
    await expect(readProgramPreview(h1.url, read, 'BUGCROWD')).rejects.toMatchObject({ reason: 'manual' });
    expect(read).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.eval).not.toHaveBeenCalled();
  });

});

describe('platform request boundaries', () => {
  it('uses fixed origins, never sends cookies and rejects redirects', async () => {
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '1'.repeat(64));
    mocks.eval.mockResolvedValue(0);
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1:80/admin' } }));
    vi.stubGlobal('fetch', fetch);
    const reader = platformReader('HACKERONE', { platform: 'HACKERONE', username: 'example', token: 'fixture' });
    try {
      await expect(reader.read('//internal.test/metadata')).rejects.toMatchObject({ reason: 'manual' });
      await expect(reader.read('/%2e%2e/metadata')).rejects.toMatchObject({ reason: 'manual' });
      await expect(reader.read(base)).rejects.toMatchObject({ reason: 'manual' });
      expect(fetch).toHaveBeenCalledTimes(1);
      const [apiUrl, apiOptions] = fetch.mock.calls[0];
      expect(apiUrl.href).toBe('https://api.hackerone.com' + base);
      expect(apiOptions).toMatchObject({ redirect: 'manual', method: 'GET', headers: { Authorization: expect.stringMatching(/^Basic /) } });
      expect(apiOptions.headers).not.toHaveProperty('Cookie');
    } finally { reader.close(); }
  });

  it('shares Retry-After cooldown for subsequent requests on the same platform', async () => {
    mocks.eval.mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValueOnce(8000);
    const fetch = vi.fn(async () => new Response(null, { status: 429, headers: { 'Retry-After': '12' } }));
    vi.stubGlobal('fetch', fetch);
    const a = platformReader('YESWEHACK');
    const b = platformReader('YESWEHACK');
    try {
      await expect(a.read('/programs/example-program')).rejects.toMatchObject({ reason: 'rate_limited', retryAfter: 12 });
      await expect(b.read('/programs/second')).rejects.toMatchObject({ reason: 'rate_limited', retryAfter: 8 });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(mocks.eval.mock.calls.map(call => call[2])).toEqual(Array(3).fill('platform-import:YESWEHACK:anonymous'));
      expect(mocks.eval.mock.calls[1][3]).toBe(12000);
    } finally { a.close(); b.close(); }
  });
});
