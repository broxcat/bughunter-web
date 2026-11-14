import type { LaunchOptions } from 'playwright-chromium';
import { scannerEnvironment } from './scanners/environment.mjs';

/**
 * Chromium executes hostile target content. Every launch (target browser and
 * PDF export) therefore:
 *  - runs with Chromium's own sandbox (Playwright defaults to --no-sandbox);
 *  - inherits only the scrubbed scanner environment, never DATABASE_URL,
 *    AUTH_SECRET, CREDENTIALS_ENCRYPTION_KEY or provider secrets;
 *  - never resolves or connects by itself (see BROWSER_EGRESS_ARGS).
 * Defense in depth inside the networkless service. Application processes use
 * isolatedBrowser.ts and must never launch Chromium locally.
 */
export const BROWSER_EGRESS_ARGS = [
  '--host-resolver-rules=MAP * ~NOTFOUND',
  '--proxy-server=http://127.0.0.1:9',
  '--proxy-bypass-list=<-loopback>',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--dns-prefetch-disable',
  '--disable-background-networking',
  '--disable-features=NetworkPrediction,DnsOverHttps,AsyncDns',
] as const;

export function browserSandboxEnabled(env: Record<string, string | undefined> = process.env) {
  const value = env.BROWSER_SANDBOX?.trim().toLowerCase();
  if (value === undefined || value === '' || value === 'enabled') return true;
  throw new Error('BROWSER_SANDBOX must be "enabled"; disabling the sandbox is unsupported');
}

export function hardenedBrowserLaunch(options: LaunchOptions = {}, env: Record<string, string | undefined> = process.env): LaunchOptions {
  const sandbox = browserSandboxEnabled(env);
  // Callers cannot re-disable the sandbox or add their own proxy/resolver.
  const args = (options.args ?? []).filter(arg => !/^--(?:no-sandbox|disable-setuid-sandbox|no-zygote|single-process|proxy-server|proxy-bypass-list|host-resolver-rules)\b/.test(arg));
  return {
    ...options,
    chromiumSandbox: sandbox,
    env: scannerEnvironment(env) as Record<string, string>,
    proxy: undefined,
    args: [...args, ...BROWSER_EGRESS_ARGS],
  };
}
