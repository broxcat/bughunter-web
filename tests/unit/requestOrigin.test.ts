import { afterEach, describe, expect, it, vi } from 'vitest';
import { foreignOrigin } from '@/lib/requestOrigin';

/** `Host` is a forbidden header for Request(), so the headers the Node server
 * actually delivers are supplied directly; the check reads only headers. */
const post = (host?: string, origin?: string) => foreignOrigin({
  headers: new Headers({ ...(host ? { host } : {}), ...(origin ? { origin } : {}) }),
} as Request);

afterEach(() => vi.unstubAllEnvs());

describe('same-origin check for browser mutations', () => {
  it('admits the configured public origin and the host actually addressed', () => {
    vi.stubEnv('AUTH_URL', 'http://100.64.0.1:3000');
    // Both published bindings are usable: the AUTH_URL host and loopback.
    expect(post('100.64.0.1:3000', 'http://100.64.0.1:3000')).toBe(false);
    expect(post('localhost:3000', 'http://localhost:3000')).toBe(false);
    // The public origin stays admitted whichever binding served the request.
    expect(post('localhost:3000', 'http://100.64.0.1:3000')).toBe(false);
    // Behind TLS termination the browser origin is https for the same host.
    expect(post('bughunter.example.test', 'https://bughunter.example.test')).toBe(false);
  });

  it('refuses a cross-site origin on every binding', () => {
    vi.stubEnv('AUTH_URL', 'http://100.64.0.1:3000');
    for (const host of ['100.64.0.1:3000', 'localhost:3000']) {
      expect(post(host, 'https://attacker.test')).toBe(true);
    }
    // A different port is a different origin, even on the same hostname.
    expect(post('localhost:3000', 'http://localhost:9999')).toBe(true);
  });

  it('does not admit an origin merely because some binding exists', () => {
    vi.stubEnv('AUTH_URL', 'http://100.64.0.1:3000');
    // Addressed as 10.0.0.9, so loopback is not the origin of this request.
    expect(post('10.0.0.9:3000', 'http://localhost:3000')).toBe(true);
    expect(post('10.0.0.9:3000', 'http://10.0.0.9:3000')).toBe(false);
  });

  it('keeps non-browser clients that omit Origin', () => {
    vi.stubEnv('AUTH_URL', 'http://100.64.0.1:3000');
    expect(post('localhost:3000')).toBe(false);
  });

  it.each(['', 'not a url'])('neither widens nor blocks everything when AUTH_URL is %o', value => {
    vi.stubEnv('AUTH_URL', value);
    expect(post('localhost:3000', 'http://localhost:3000')).toBe(false);
    expect(post('localhost:3000', 'https://attacker.test')).toBe(true);
  });

  it('refuses every browser origin when no host reaches the handler', () => {
    vi.stubEnv('AUTH_URL', '');
    expect(post(undefined, 'http://localhost:3000')).toBe(true);
  });
});
