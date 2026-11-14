import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { classifyAddress, deniedHostname } from './addressPolicy';

export class EgressError extends Error {
  constructor(public readonly code: string, message: string) { super(`${code}: ${message}`); this.name = 'EgressError'; }
}
export type LookupAll = (hostname: string) => Promise<{ address: string; family: number }[]>;
export type PinnedTarget = { hostname: string; port: number; address: string; family: 4 | 6; source: 'LITERAL' | 'DNS' | 'LAB_ALLOWLIST' | 'OPERATOR_ENDPOINT' };
export type ResolveOptions = {
  usage?: 'lab-target' | 'ai-provider' | 'admin-service' | 'public-provider';
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Exact operator-configured origins (scheme://host:port) that may be private. */
  operatorOrigin?: boolean;
  lookupAll?: LookupAll;
};

const defaultLookup: LookupAll = hostname => dnsLookup(hostname, { all: true, verbatim: true });

/**
 * Administrator lab exception: EGRESS_LAB_ALLOWLIST="host:port=ip[,host:port=ip]".
 * Exact host, exact port, exact address. No wildcards, no ranges, no DNS: the
 * connection is pinned to the declared address. Malformed entries are ignored
 * (never widened) and reported by `labAllowlistErrors`.
 */
export function parseLabAllowlist(raw = process.env.EGRESS_LAB_ALLOWLIST ?? '') {
  const entries = new Map<string, { address: string; family: 4 | 6 }>(), errors: string[] = [];
  for (const item of raw.split(',').map(s => s.trim()).filter(Boolean)) {
    const match = item.match(/^(\[[0-9a-f:.]+\]|[a-z0-9.-]+):(\d{1,5})=(\[?[0-9a-f:.]+\]?)$/i);
    const address = match?.[3].replace(/^\[|\]$/g, '') ?? '';
    const port = Number(match?.[2]);
    const family = isIP(address);
    if (!match || !family || port < 1 || port > 65535) { errors.push(item); continue; }
    entries.set(`${match[1].toLowerCase().replace(/^\[|\]$/g, '')}:${port}`, { address, family: family as 4 | 6 });
  }
  return { entries, errors };
}
export const labAllowlistErrors = () => parseLabAllowlist().errors;

async function bounded<T>(work: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined, onAbort: (() => void) | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new EgressError('EGRESS_DNS_TIMEOUT', 'DNS resolution exceeded its deadline')), ms);
      if (signal) { onAbort = () => reject(signal.reason ?? new Error('aborted')); if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    })]);
  } finally { clearTimeout(timer); if (onAbort) signal?.removeEventListener('abort', onAbort); }
}

/**
 * Resolve once, validate every returned address, return one pinned address.
 * Mixed public/private answers are refused (an attacker controls ordering and
 * the client's choice). Fails closed on timeout, empty answers or any error.
 */
export async function resolveEgressTarget(rawHost: string, port: number, options: ResolveOptions = {}): Promise<PinnedTarget> {
  const hostname = rawHost.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!hostname || !Number.isInteger(port) || port < 1 || port > 65535) throw new EgressError('EGRESS_INVALID_DESTINATION', 'Invalid host or port');
  options.signal?.throwIfAborted();
  const usage = options.usage ?? 'lab-target';
  const lab = usage === 'lab-target' ? parseLabAllowlist().entries.get(`${hostname}:${port}`) : undefined;
  if (lab) return { hostname, port, ...lab, source: 'LAB_ALLOWLIST' };
  if (options.operatorOrigin && usage !== 'ai-provider' && usage !== 'admin-service') throw new EgressError('EGRESS_POLICY_MISMATCH', 'Private operator exceptions require an explicit service usage');
  if (isIP(hostname)) {
    if (options.operatorOrigin) return { hostname, port, address: hostname, family: isIP(hostname) as 4 | 6, source: 'OPERATOR_ENDPOINT' };
    const verdict = classifyAddress(hostname);
    if (!verdict.allowed) throw new EgressError('EGRESS_DESTINATION_BLOCKED', `Address class ${verdict.reason} is not a public target`);
    return { hostname, port, address: verdict.address, family: verdict.family, source: 'LITERAL' };
  }
  if (!options.operatorOrigin && deniedHostname(hostname)) throw new EgressError('EGRESS_DESTINATION_BLOCKED', 'Hostname names a local or infrastructure service');
  let answers: { address: string; family: number }[];
  try { answers = await bounded((options.lookupAll ?? defaultLookup)(hostname), options.timeoutMs ?? 3000, options.signal); }
  catch (error) { options.signal?.throwIfAborted(); if (error instanceof EgressError) throw error; throw new EgressError('EGRESS_DNS_FAILED', 'Destination did not resolve'); }
  if (!answers.length) throw new EgressError('EGRESS_DNS_FAILED', 'Destination did not resolve');
  if (options.operatorOrigin) {
    const first = answers.find(a => isIP(a.address));
    if (!first) throw new EgressError('EGRESS_DNS_FAILED', 'Destination did not resolve');
    return { hostname, port, address: first.address, family: isIP(first.address) as 4 | 6, source: 'OPERATOR_ENDPOINT' };
  }
  const verdicts = answers.map(a => classifyAddress(a.address));
  const denied = verdicts.find(v => !v.allowed);
  if (denied && !denied.allowed) throw new EgressError('EGRESS_DESTINATION_BLOCKED', `Resolved address class ${denied.reason} is not a public target`);
  const chosen = verdicts[0] as Extract<typeof verdicts[number], { allowed: true }>;
  return { hostname, port, address: chosen.address, family: chosen.family, source: 'DNS' };
}

/** A net/tls/http `lookup` that only ever returns the pinned address. */
export function pinnedLookup(target: PinnedTarget) {
  return (hostname: string, options: { all?: boolean } | number | undefined, callback: (...args: unknown[]) => void) => {
    if (hostname.toLowerCase().replace(/^\[|\]$/g, '') !== target.hostname) { callback(new EgressError('EGRESS_PIN_MISMATCH', 'Unexpected connection host')); return; }
    if (typeof options === 'object' && options?.all) callback(null, [{ address: target.address, family: target.family }]);
    else callback(null, target.address, target.family);
  };
}
