import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { Readable, pipeline } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { EgressError, pinnedLookup, resolveEgressTarget, type LookupAll, type PinnedTarget } from './resolve';

export { EgressError } from './resolve';
export type GuardedFetchInit = {
  method?: string;
  headers?: HeadersInit;
  body?: string | Uint8Array;
  signal?: AbortSignal;
  /** Total deadline covering DNS, connect, headers and body. */
  timeoutMs?: number;
  /** Redirects are never followed. 'error' rejects 3xx; 'manual' returns it. */
  redirect?: 'manual' | 'error';
  /** Exact operator-configured endpoint (env-defined); may be private, still pinned. */
  operatorEndpoint?: boolean;
  usage?: 'lab-target' | 'ai-provider' | 'admin-service' | 'public-provider';
  lookupAll?: LookupAll;
  onPinned?: (target: PinnedTarget) => void;
};
const canonicalAddress = (address: string) => {
  const plain = address.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');
  return net.isIP(plain) === 6 ? new URL(`http://[${plain}]/`).hostname : plain;
};
const NULL_BODY = new Set([101, 204, 205, 304]);

function destination(input: string | URL) {
  const url = new URL(input);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new EgressError('EGRESS_INVALID_DESTINATION', 'Only credential-free HTTP(S) URLs are allowed');
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  return { url, port, hostname: url.hostname.replace(/^\[|\]$/g, '') };
}

/**
 * The single HTTP client for user/target-influenced destinations. DNS happens
 * exactly once in resolveEgressTarget; the socket receives that pinned address
 * through `lookup`, while Host, SNI and certificate verification keep using the
 * original hostname. Redirects are never followed.
 */
export async function guardedFetch(input: string | URL, init: GuardedFetchInit = {}): Promise<Response> {
  const { url, port, hostname } = destination(input);
  const deadline = AbortSignal.timeout(init.timeoutMs ?? 15000);
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  const target = await resolveEgressTarget(hostname, port, { signal, usage: init.usage, operatorOrigin: init.operatorEndpoint, lookupAll: init.lookupAll });
  init.onPinned?.(target);
  signal.throwIfAborted();
  const headers: Record<string, string | string[]> = {};
  new Headers(init.headers).forEach((value, key) => { if (key !== 'host' && key !== 'connection' && key !== 'transfer-encoding') headers[key] = value; });
  headers['accept-encoding'] ??= 'gzip, deflate, br';
  const client = url.protocol === 'https:' ? https : http;
  return await new Promise<Response>((resolve, reject) => {
    const request = client.request({
      protocol: url.protocol, hostname, port, path: url.pathname + url.search, method: init.method ?? 'GET', headers,
      agent: false, signal, lookup: pinnedLookup(target) as never,
      ...(url.protocol === 'https:' && !net.isIP(hostname) ? { servername: hostname } : {}),
    });
    request.once('error', error => reject(signal.aborted ? (signal.reason ?? error) : error));
    request.once('response', res => {
      // Literal-IP hosts skip `lookup`; confirm the connected peer either way.
      const peer = res.socket?.remoteAddress;
      if (peer && canonicalAddress(peer) !== canonicalAddress(target.address)) { res.destroy(); reject(new EgressError('EGRESS_PIN_MISMATCH', 'Connected peer differs from the validated address')); return; }
      const status = res.statusCode ?? 0;
      if (init.redirect === 'error' && status >= 300 && status < 400) { res.destroy(); reject(new EgressError('EGRESS_REDIRECT_REFUSED', 'Redirects are not followed')); return; }
      const responseHeaders = new Headers();
      for (let i = 0; i + 1 < res.rawHeaders.length; i += 2) { try { responseHeaders.append(res.rawHeaders[i], res.rawHeaders[i + 1]); } catch { /* invalid header dropped */ } }
      try {
        if (NULL_BODY.has(status) || init.method?.toUpperCase() === 'HEAD') { res.resume(); resolve(new Response(null, { status, headers: responseHeaders })); }
        else {
          let body: Readable = res;
          const encoding = responseHeaders.get('content-encoding')?.trim().toLowerCase();
          const decompress = encoding === 'gzip' || encoding === 'x-gzip' ? createGunzip() : encoding === 'deflate' ? createInflate() : encoding === 'br' ? createBrotliDecompress() : undefined;
          if (decompress) {
            body = decompress;
            pipeline(res, decompress, error => { if (error) decompress.destroy(error); });
            decompress.once('close', () => { if (!res.complete) res.destroy(); });
            // Expose headers for the decoded representation (also safe to fulfill
            // into Chromium and relay consumers without a second decompression).
            responseHeaders.delete('content-encoding');
            responseHeaders.delete('content-length');
          }
          responseHeaders.delete('transfer-encoding');
          resolve(new Response(Readable.toWeb(body) as ReadableStream<Uint8Array>, { status, headers: responseHeaders }));
        }
      } catch (error) { res.destroy(); reject(error); }
    });
    request.end(init.body);
  });
}

/** TCP/TLS connections to a validated, pinned peer (no later resolution). */
type ConnectOptions = { signal?: AbortSignal; timeoutMs?: number; lookupAll?: LookupAll };
async function pinnedPeer(host: string, port: number, options: ConnectOptions) {
  const target = await resolveEgressTarget(host, port, { signal: options.signal, timeoutMs: options.timeoutMs, lookupAll: options.lookupAll });
  options.signal?.throwIfAborted();
  return { target, base: { host: target.address, port, family: target.family, signal: options.signal, autoSelectFamily: false } as const };
}
export async function guardedConnect(host: string, port: number, options: ConnectOptions = {}) {
  const { target, base } = await pinnedPeer(host, port, options);
  return { target, socket: net.connect(base) };
}
/** TLS keeps SNI and certificate identity checks on the original hostname. */
export async function guardedTlsConnect(host: string, port: number, options: ConnectOptions = {}) {
  const { target, base } = await pinnedPeer(host, port, options);
  return { target, socket: tls.connect({ ...base, servername: net.isIP(target.hostname) ? undefined : target.hostname }) };
}

/**
 * Operator endpoints are origins named only in server environment variables
 * (never in user settings): explicit OLLAMA_HOST and
 * RESEARCH_EMBEDDING_URL. A user-saved base URL with the exact same origin is
 * allowed to be private; any other origin must be public.
 */
export function isOperatorEndpoint(value: string | URL, env: Record<string, string | undefined> = process.env): boolean {
  let origin: string;
  try { origin = new URL(value).origin; } catch { return false; }
  return [env.OLLAMA_HOST?.trim(), env.RESEARCH_EMBEDDING_URL?.trim()].some(raw => {
    if (!raw) return false;
    try { return new URL(raw).origin === origin; } catch { return false; }
  });
}
/** AI/embedding transport: pinned, never redirected, public unless operator-defined. */
export function guardedProviderFetch(url: string, init: Omit<GuardedFetchInit, 'operatorEndpoint' | 'redirect' | 'usage'> = {}) {
  return guardedFetch(url, { ...init, usage: 'ai-provider', redirect: 'error', operatorEndpoint: isOperatorEndpoint(url) });
}
/** Internal administration is a separate, explicit operator policy. */
export function guardedAdminFetch(url: string, init: Omit<GuardedFetchInit, 'operatorEndpoint' | 'redirect' | 'usage'> = {}) {
  const origins = (process.env.EGRESS_ADMIN_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!origins.some(origin => { try { return new URL(origin).origin === new URL(url).origin; } catch { return false; } })) throw new EgressError('EGRESS_ADMIN_REFUSED', 'Service origin is not configured');
  return guardedFetch(url, { ...init, usage: 'admin-service', operatorEndpoint: true, redirect: 'error' });
}
export function guardedPublicProviderFetch(url: string, init: Omit<GuardedFetchInit, 'operatorEndpoint' | 'redirect' | 'usage'> = {}) {
  return guardedFetch(url, { ...init, usage: 'public-provider', operatorEndpoint: false, redirect: 'error' });
}
/** Settings-time check so an unsafe provider URL is rejected before it is stored. */
export async function assertProviderEndpoint(url: string, options: { lookupAll?: LookupAll } = {}) {
  const { url: parsed, port, hostname } = destination(url);
  if (isOperatorEndpoint(parsed)) return;
  await resolveEgressTarget(hostname, port, { usage: 'ai-provider', lookupAll: options.lookupAll, timeoutMs: 3000 });
}
