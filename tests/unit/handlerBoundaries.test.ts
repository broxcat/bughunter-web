/// <reference types="vite/client" />
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), business: vi.fn(() => { throw new Error('Business access before validation'); }) }));
vi.mock('@/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/prisma', () => ({ prisma: new Proxy({}, { get: () => new Proxy({}, { get: () => mocks.business }) }) }));
const routes = import.meta.glob('../../src/app/api/**/route.ts');
const invalid = ['..', '', 'a/b', 'a%2fb', 'white space', '<script>', "' OR 1=1", 'é', 'x'.repeat(129)];
type Handler = (req: NextRequest, context: { params: Promise<Record<string, unknown>> }) => Promise<Response>;

describe('B6: actual handler exports, bypassing the proxy', () => {
  for (const [path, load] of Object.entries(routes).filter(([path]) => !path.includes('[...nextauth]'))) {
    const keys = [...path.matchAll(/\[(\w+)\]/g)].map(match => match[1]);
    it(path.replace('../../src/app', ''), async () => {
      const routeModule = await load() as Record<string, Handler>;
      const methods = Object.keys(routeModule).filter(name => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(name));
      expect(methods.length).toBeGreaterThan(0);
      mocks.auth.mockClear(); mocks.business.mockClear();
      for (const method of methods) {
        const handler = routeModule[method];
        const params = Object.fromEntries(keys.map(key => [key, 'valid-id']));
        for (const key of keys) for (const value of [...invalid, undefined, ['array']]) {
          const response = await handler(new NextRequest('http://fixture.test/api/direct', { method }), { params: Promise.resolve({ ...params, [key]: value }) });
          expect(response.status, `${method} ${key}=${String(value)}`).toBe(404);
        }
        for (const query of ['targetId=a%2Fb', 'runId=..', 'page=NaN', 'pageSize=101', 'programId=a&programId=b', 'ids=a,%3Cscript%3E']) {
          const response = await handler(new NextRequest(`http://fixture.test/api/direct?${query}`, { method }), { params: Promise.resolve(params) });
          expect(response.status, `${method} ${query}`).toBe(400);
        }
      }
      expect(mocks.auth).not.toHaveBeenCalled();
      expect(mocks.business).not.toHaveBeenCalled();
    }, 30_000);
  }
  it('inventories all 63 route files including Auth.js', () => expect(Object.keys(routes)).toHaveLength(63));
  it('refuses malformed body identifiers before database/queue work', async () => {
    vi.stubEnv('AUTH_URL', 'http://fixture.test');
    mocks.auth.mockResolvedValue({ user: { id: 'owner' } }); mocks.business.mockClear();
    try {
      for (const [path, body] of [
        ['scan-runs', { targetId: '../bad', type: 'RECON' }],
        ['targets', { scopeId: '../bad', host: 'fixture.test' }],
        ['findings', { targetId: '../bad', title: 'fixture' }],
      ] as const) {
        const route = await routes[`../../src/app/api/${path}/route.ts`]() as Record<string, Handler>;
        const response = await route.POST(new NextRequest(`http://fixture.test/api/${path}`, { method: 'POST', headers: { Origin: 'http://fixture.test', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({}) });
        expect(response.status).toBe(400);
      }
      expect(mocks.business).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });
});
