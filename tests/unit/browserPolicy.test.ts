import { describe, expect, it } from 'vitest';
import { BROWSER_EGRESS_ARGS, browserSandboxEnabled, hardenedBrowserLaunch } from '@/server/browserPolicy';

const secrets = { DATABASE_URL: 'postgres://u:p@db/x', AUTH_SECRET: 's', CREDENTIALS_ENCRYPTION_KEY: 'a'.repeat(64), REDIS_URL: 'redis://:pw@redis', GITHUB_SECRET: 'g', PATH: '/usr/bin', HOME: '/home/app' };

describe('hardened Chromium launch (H1)', () => {
  it('enables the Chromium sandbox and refuses caller attempts to disable it or reroute traffic', () => {
    const options = hardenedBrowserLaunch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--single-process', '--proxy-server=http://evil:1', '--host-resolver-rules=MAP * 10.0.0.1', '--disable-dev-shm-usage'], proxy: { server: 'http://evil:1' } }, secrets);
    expect(options.chromiumSandbox).toBe(true);
    expect(options.proxy).toBeUndefined();
    expect(options.args).toEqual(['--disable-dev-shm-usage', ...BROWSER_EGRESS_ARGS]);
  });
  it('passes only the scrubbed scanner environment to the browser process tree', () => {
    const env = hardenedBrowserLaunch({}, secrets).env!;
    expect(Object.keys(env).sort()).toEqual(['HOME', 'PATH']);
    expect(JSON.stringify(env)).not.toMatch(/postgres|redis:|AUTH|aaaa/);
  });
  it('refuses sandbox opt-outs and ambiguous values', () => {
    expect(browserSandboxEnabled({})).toBe(true);
    expect(browserSandboxEnabled({ BROWSER_SANDBOX: 'enabled' })).toBe(true);
    expect(() => browserSandboxEnabled({ BROWSER_SANDBOX: 'disabled' })).toThrow(/unsupported/);
    expect(() => browserSandboxEnabled({ BROWSER_SANDBOX: 'false' })).toThrow(/unsupported/);
    expect(() => hardenedBrowserLaunch({}, { BROWSER_SANDBOX: 'disabled' })).toThrow(/unsupported/);
  });
});
