import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.findUnique } } }));
import { jwtCallback, sessionMaxAgeSeconds, sessionStillValid } from '@/lib/auth';

describe('server-side session revocation (M3)', () => {
  beforeEach(() => mocks.findUnique.mockReset());
  it('accepts a token only while its user exists with the same session version', async () => {
    mocks.findUnique.mockResolvedValue({ sessionVersion: 3 });
    expect(await sessionStillValid({ id: 'u1', sv: 3 })).toBe(true);
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' }, select: { sessionVersion: true } });
    expect(await sessionStillValid({ id: 'u1', sv: 2 })).toBe(false); // revoked by a version bump
    mocks.findUnique.mockResolvedValue(null);
    expect(await sessionStillValid({ id: 'u1', sv: 3 })).toBe(false); // deleted account
  });
  it('treats pre-migration tokens as version 0 and refuses tokens without identity', async () => {
    mocks.findUnique.mockResolvedValue({ sessionVersion: 0 });
    expect(await sessionStillValid({ sub: 'u1' })).toBe(true);
    mocks.findUnique.mockResolvedValue({ sessionVersion: 1 });
    expect(await sessionStillValid({ sub: 'u1' })).toBe(false);
    expect(await sessionStillValid({})).toBe(false);
  });
  it('the Auth.js jwt callback stamps the version at sign-in and signs out revoked tokens', async () => {
    expect(await jwtCallback({ token: { sub: 'u1' } as Record<string, unknown>, user: { id: 'u1', sessionVersion: 4 } })).toMatchObject({ id: 'u1', sv: 4 });
    expect(mocks.findUnique).not.toHaveBeenCalled();
    mocks.findUnique.mockResolvedValue({ sessionVersion: 5 });
    expect(await jwtCallback({ token: { id: 'u1', sv: 4 } })).toBeNull();
    mocks.findUnique.mockResolvedValue({ sessionVersion: 4 });
    expect(await jwtCallback({ token: { id: 'u1', sv: 4 } })).toEqual({ id: 'u1', sv: 4 });
  });
  it('bounds session lifetime (default 12h, 1h..7d) instead of the 30-day default', () => {
    expect(sessionMaxAgeSeconds({})).toBe(12 * 3600);
    expect(sessionMaxAgeSeconds({ SESSION_MAX_AGE_HOURS: '2' })).toBe(7200);
    for (const bad of ['0', '-1', '1000', 'abc', '1.5']) expect(sessionMaxAgeSeconds({ SESSION_MAX_AGE_HOURS: bad })).toBe(12 * 3600);
  });
  it('ships an additive migration and an operator revocation command', () => {
    const migration = readFileSync(new URL('../../prisma/migrations/20261114120000_user_session_version/migration.sql', import.meta.url), 'utf8');
    expect(migration).toMatch(/ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0/);
    expect(readFileSync(new URL('../../scripts/revoke-sessions.mjs', import.meta.url), 'utf8')).toMatch(/sessionVersion: \{ increment: 1 \}/);
  });
});
