import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/auth', () => ({ auth: (handler: unknown) => handler }));
import { apiPathRejected, config, isPublic } from '@/proxy';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pathToRegexp } = require('next/dist/compiled/path-to-regexp') as { pathToRegexp: (path: string) => RegExp };

const matched = (path: string) => config.matcher.some(pattern => pathToRegexp(pattern).test(path));
function routes(dir = join(process.cwd(), 'src/app/api')): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? routes(full) : name === 'route.ts' ? ['/api/' + relative(join(process.cwd(), 'src/app/api'), dir).split(String.fromCharCode(92)).join('/')] : [];
  });
}

describe('proxy coverage (B2)', () => {
  it('matches every API path, including dynamic segments that end in asset extensions', () => {
    for (const path of ['/api/findings/abc.json', '/api/scan-runs/x.js/summary', '/api/programs/p/scope.md', '/api/recon/runs/r.txt/report/pdf', '/api/health', '/api/x.map'])
      expect(matched(path), path).toBe(true);
    expect(matched('/targets')).toBe(true);
    expect(matched('/_next/static/chunk.js')).toBe(false);
    expect(matched('/logo.png')).toBe(false);
  });
  it('keeps only the documented public allowlist (no legacy /api/internal exception)', () => {
    for (const path of ['/api/internal/recon-observations', '/api/internal/research-traffic', '/api/healthz', '/api/authx', '/api/registerx'])
      expect(isPublic(path), path).toBe(false);
    for (const path of ['/', '/login', '/register', '/api/health', '/api/register', '/api/auth/session', '/api/auth/callback/credentials'])
      expect(isPublic(path), path).toBe(true);
  });
});

describe('route parameter validation (B6)', () => {
  const all = routes();
  it('covers every route under src/app/api', () => { expect(all.length).toBeGreaterThan(50); });
  it('admits opaque identifiers and fixed route names on every real route', () => {
    for (const route of all) {
      const path = route.replace(/\[\.\.\.[^\]]+\]/g, 'session').replace(/\[[^\]]+\]/g, 'clx9a8b7c6d5e4f3g2h1EV-1f2e');
      expect(apiPathRejected(path), path).toBe(false);
    }
  });
  it('rejects malformed values in every dynamic segment before authentication', () => {
    const bad = ['..', '.', '%2e%2e', 'a%2Fb', 'a b', "1'OR'1'='1", '<script>', 'x'.repeat(129), '.hidden', 'été'];
    for (const route of all.filter(route => /\[(?!\.\.\.)[^\]]+\]/.test(route))) {
      for (const value of bad) {
        const path = route.replace(/\[\.\.\.[^\]]+\]/g, 'session').replace(/\[[^\]]+\]/, encodeURIComponent(value) === value ? value : encodeURIComponent(value)).replace(/\[[^\]]+\]/g, 'id1');
        expect(apiPathRejected(path), path).toBe(true);
      }
    }
  });
  it('rejects empty segments and leaves non-API paths alone', () => {
    expect(apiPathRejected('/api/findings//lifecycle')).toBe(true);
    expect(apiPathRejected('/targets/..')).toBe(false);
  });
});
