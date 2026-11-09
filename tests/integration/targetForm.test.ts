import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { decryptSecret } from '@/lib/crypto';
import { programPolicyBlocker, programPolicyInclude } from '@/server/programExecutionPolicy';

const auth = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth }));

const db = process.env.TEST_DATABASE_URL;
const suite = db ? describe : describe.skip;
const request = (body: unknown, method = 'POST') => new Request('http://app.example.test/api/programs', {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const fixture = (name: string) => ({
  companyName: name,
  platform: 'PRIVATE',
  targetReview: {
    scopeIn: [{ value: 'https://app.example.test', type: 'WEB_APPLICATION' }],
    documentedAssets: [{ ref: 'mobile', originalValue: 'com.example.app', sourceType: 'Android' }],
    rules: [{ text: 'Use only an owned account.', decision: null as string | null }],
    policy: {
      automationAllowed: true, requiredUserAgent: 'Fixture/1', requiredHeaders: [],
      exclusions: [] as string[], requestsPerSecond: 2, maxConcurrency: 1, forbiddenCategories: [],
    },
    testAccounts: [] as { asset: string; loginUrl: string; username: string; password: string; purpose: string }[],
  },
});

suite('reviewed target form with PostgreSQL', () => {
  let ownerId: string, otherId: string;
  let prisma: typeof import('@/lib/prisma').prisma;
  let post: typeof import('@/app/api/programs/route').POST;
  let settings: typeof import('@/app/api/programs/[id]/route');

  beforeAll(async () => {
    process.env.DATABASE_URL = db;
    vi.stubEnv('CREDENTIALS_ENCRYPTION_KEY', '2'.repeat(64));
    ({ prisma } = await import('@/lib/prisma'));
    ({ POST: post } = await import('@/app/api/programs/route'));
    settings = await import('@/app/api/programs/[id]/route');
    const users = await Promise.all(['owner', 'other'].map(role => prisma.user.create({
      data: { email: 'review-' + role + '-' + crypto.randomUUID() + '@example.test' },
    })));
    [ownerId, otherId] = users.map(user => user.id);
    auth.mockImplementation(async () => ({ user: { id: ownerId } }));
  });

  afterAll(async () => {
    await prisma?.target.deleteMany({ where: { userId: { in: [ownerId, otherId].filter(Boolean) } } });
    await prisma?.bountyProgram.deleteMany({ where: { ownerId: { in: [ownerId, otherId].filter(Boolean) } } });
    await prisma?.scope.deleteMany({ where: { userId: { in: [ownerId, otherId].filter(Boolean) } } });
    await prisma?.user.deleteMany({ where: { id: { in: [ownerId, otherId].filter(Boolean) } } });
    await prisma?.$disconnect();
    vi.unstubAllEnvs();
  });

  it('creates an owner-reviewed manual target with documented assets and blocks undecided rules', async () => {
    const response = await post(request(fixture('Manual reviewed target')));
    expect(response.status).toBe(201);
    const { id } = await response.json();
    const program = await prisma.bountyProgram.findUniqueOrThrow({ where: { id }, include: { ...programPolicyInclude, scopeAssets: true } });
    expect(program.scopeAssets.map(asset => asset.normalizedValue)).toEqual(['https://app.example.test/']);
    expect(program.executionPolicies[0].policy).toMatchObject({
      reviewState: 'OWNER_REVIEWED',
      sourceSnapshot: { documentedAssets: [{ originalValue: 'com.example.app' }], unrepresentedRules: ['Use only an owned account.'] },
    });
    expect(programPolicyBlocker(program)).toMatch(/unrepresented program or scope rules/);
    const params = { params: Promise.resolve({ id }) };
    const review = await (await settings.GET(new Request('http://app.example.test'), params)).json();
    auth.mockResolvedValueOnce({ user: { id: otherId } });
    expect((await settings.GET(new Request('http://app.example.test'), params)).status).toBe(404);
    const update = fixture('Manual reviewed target');
    update.targetReview.rules[0].decision = 'CONVERTED';
    update.targetReview.testAccounts.push({ asset: 'https://app.example.test', loginUrl: 'https://app.example.test/login', username: 'fixture-user', password: 'fixture-password', purpose: 'ACCOUNT_A' });
    const saved = await settings.PATCH(request({
      expectedUpdatedAt: review.updatedAt, expectedPolicyVersion: 1,
      expectedLegacyScopeFingerprint: review.legacyPolicyReview.scopeFingerprint,
      targetReview: { ...update.targetReview, expectedAssets: review.expectedAssets },
    }, 'PATCH'), params);
    expect(saved.status).toBe(200);
    const savedProgram = await prisma.bountyProgram.findUniqueOrThrow({ where: { id }, include: programPolicyInclude });
    expect(programPolicyBlocker(savedProgram)).toBeNull();
    const account = await prisma.targetCredential.findFirstOrThrow({ where: { target: { programId: id } } });
    expect(decryptSecret(account.passwordCipher!)).toBe('fixture-password');
    const accountResponse = await (await settings.GET(new Request('http://app.example.test'), params)).json();
    expect(accountResponse).not.toHaveProperty('testAccounts');
    expect(JSON.stringify(accountResponse)).not.toContain('fixture-password');
    expect(JSON.stringify(accountResponse)).not.toContain(account.passwordCipher);
    expect(await prisma.targetReconRun.count({ where: { programId: id } })).toBe(0);
    await prisma.target.deleteMany({ where: { programId: id } });
  });

  it('rejects the same canonical asset on both sides of scope', async () => {
    const data = fixture('Conflict should not persist');
    data.targetReview.policy.exclusions = ['https://APP.example.test/'];
    const response = await post(request(data));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('from one side of scope');
    expect(await prisma.bountyProgram.count({ where: { ownerId, companyName: data.companyName } })).toBe(0);
  });

  it('rolls back policy, scope and the first credential when the second credential fails', async () => {
    const data = fixture('Transaction should roll back');
    data.targetReview.policy.exclusions = ['https://app.example.test/admin/*'];
    data.targetReview.testAccounts = [
      { asset: 'https://app.example.test', loginUrl: 'https://app.example.test/login', username: 'a', password: 'one', purpose: 'ACCOUNT_A' },
      { asset: 'https://app.example.test', loginUrl: 'https://app.example.test/admin/login', username: 'b', password: 'two', purpose: 'ACCOUNT_B' },
    ];
    const counts = () => Promise.all([
      prisma.bountyProgram.count({ where: { ownerId } }),
      prisma.scopeAsset.count({ where: { program: { ownerId } } }),
      prisma.programExecutionPolicy.count({ where: { program: { ownerId } } }),
      prisma.scope.count({ where: { userId: ownerId } }),
      prisma.targetCredential.count({ where: { target: { userId: ownerId } } }),
    ]);
    const before = await counts();
    const response = await post(request(data));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('Test account login is excluded');
    expect(await counts()).toEqual(before);
  });
});
