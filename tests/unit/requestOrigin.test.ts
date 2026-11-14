import { afterEach, describe, expect, it, vi } from 'vitest';
import { foreignOrigin } from '@/lib/requestOrigin';

/** `Host` is a forbidden header for Request(), so the headers the Node server
 * actually delivers are supplied directly; the check reads only headers/url. */
const post = (host?: string, origin?: string, extra: Record<string, string> = {}, url?: string) => foreignOrigin({
  url, headers: new Headers({ ...(host ? { host } : {}), ...(origin ? { origin } : {}), ...extra }),
} as Request);

afterEach(() => vi.unstubAllEnvs());

describe('same-origin check for browser mutations (B1)', () => {
  it('admits only the configured public origin, whatever Host the request carried', () => {
    vi.stubEnv('AUTH_URL', 'http://100.64.0.1:3000');
    expect(post('100.64.0.1:3000', 'http://100.64.0.1:3000')).toBe(false);
    expect(post('localhost:3000', 'http://100.64.0.1:3000')).toBe(false);
    // Host-derived origins no longer widen the set (DNS rebinding, other bindings).
    expect(post('localhost:3000', 'http://localhost:3000')).toBe(true);
    expect(post('rebind.attacker.test:3000', 'http://rebind.attacker.test:3000')).toBe(true);
    expect(post('100.64.0.1:3000', 'https://100.64.0.1:3000')).toBe(true);
  });

  it('refuses cross-site origins, other ports and the opaque null origin', () => {
    vi.stubEnv('AUTH_URL', 'http://100.64.0.1:3000');
    expect(post('100.64.0.1:3000', 'https://attacker.test')).toBe(true);
    expect(post('100.64.0.1:3000', 'http://100.64.0.1:9999')).toBe(true);
    expect(post('100.64.0.1:3000', 'null')).toBe(true);
  });

  it('refuses mutations without Origin, including scripted clients', () => {
    vi.stubEnv('AUTH_URL', 'http://100.64.0.1:3000');
    expect(post('100.64.0.1:3000')).toBe(true);
  });

  it('honours Fetch Metadata even when Origin looks right', () => {
    vi.stubEnv('AUTH_URL', 'http://100.64.0.1:3000');
    expect(post('100.64.0.1:3000', 'http://100.64.0.1:3000', { 'sec-fetch-site': 'cross-site' })).toBe(true);
    expect(post('100.64.0.1:3000', 'http://100.64.0.1:3000', { 'sec-fetch-site': 'same-site' })).toBe(true);
    expect(post('100.64.0.1:3000', 'http://100.64.0.1:3000', { 'sec-fetch-site': 'same-origin' })).toBe(false);
  });

  it.each(['', 'not a url', 'javascript:alert(1)'])('without a usable AUTH_URL (%o) only the addressed origin is admitted', value => {
    vi.stubEnv('AUTH_URL', value);
    expect(post('localhost:3000', 'http://localhost:3000', {}, 'http://localhost:3000/api/x')).toBe(false);
    expect(post('localhost:3000', 'https://attacker.test', {}, 'http://localhost:3000/api/x')).toBe(true);
    expect(post('localhost:3000', 'http://localhost:3000')).toBe(false);
  });

  it('refuses every browser origin when neither AUTH_URL nor an addressed origin exists', () => {
    vi.stubEnv('AUTH_URL', '');
    expect(post(undefined, 'http://localhost:3000')).toBe(true);
  });
});
