import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ auth: (handler: unknown) => handler }));
import proxy from '@/proxy';

async function request(path: string, authenticated = false) {
  const req = Object.assign(new NextRequest(`http://localhost:3000${path}`), { auth: authenticated ? { user: { id: 'owner' } } : null });
  return (proxy as unknown as (input: NextRequest) => Promise<Response>)(req);
}

describe('authentication proxy response contract', () => {
  it.each(['/api/programs', '/api/scan-runs', '/api/recon/runs/private/report'])('returns JSON 401 for %s', async path => {
    const response = await request(path);
    expect(response.status).toBe(401);
    expect(response.headers.has('location')).toBe(false);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });
  it('retains the document redirect with its query and callback', async () => {
    const response = await request('/targets/private?tab=Recon');
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).searchParams.get('callbackUrl')).toBe('/targets/private?tab=Recon');
  });
  it.each(['/api/health', '/api/register', '/api/auth/session', '/api/internal/recon-observations'])('leaves public handler authentication intact: %s', async path => {
    expect((await request(path)).headers.get('x-middleware-next')).toBe('1');
  });
  it('allows authenticated requests to reach ownership checks', async () => {
    expect((await request('/api/programs', true)).headers.get('x-middleware-next')).toBe('1');
  });
});
