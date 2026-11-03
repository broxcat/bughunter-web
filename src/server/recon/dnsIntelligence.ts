import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { classifyReconFailure, type ReconFailure } from '@/lib/reconCapabilities';

/** A terminal negative DNS answer is completed observation, whereas a timeout
 * or resolver/network failure leaves coverage incomplete even when another
 * record type (or another host) resolves successfully. */
export function dnsLookupCoverage(results: PromiseSettledResult<unknown>[]) {
  const codes = results.flatMap(result => {
    if (result.status === 'fulfilled') return [];
    const error = result.reason;
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) :
      error instanceof Error ? error.message : String(error);
    return [code];
  });
  const incomplete = codes.filter(code => !/\b(?:ENODATA|ENOTFOUND|NXDOMAIN|ENONAME)\b/i.test(code));
  return { complete: incomplete.length === 0, codes, incomplete };
}

/** Resolver supplied by the guarded execution. Negative DNS controls are never
 * promoted into discovered hosts and never authorize CNAME/IP destinations. */
export async function wildcardDnsBaseline(seed: string, resolve: (hostname: string) => Promise<string[]>, allowed: (hostname: string) => boolean) {
  const samples: string[][] = [], failures: ReconFailure[] = [];
  for (let i = 0; i < 2; i++) {
    const host = `bh-control-${randomUUID().replaceAll('-', '')}.${seed}`;
    if (!allowed(host)) throw new Error('SCOPE_BLOCKED: DNS control outside wildcard');
    try { samples.push([...new Set((await resolve(host)).filter(ip => isIP(ip)))].sort()); }
    catch (error) {
      const failure = classifyReconFailure(error, 'DNS_RESOLUTION', 'native-dns');
      if (['SCOPE_BLOCKED', 'CANCELLED'].includes(failure.reason)) throw error;
      // Terminal NXDOMAIN/ENODATA is a valid negative control, not a timeout.
      if (!dnsLookupCoverage([{ status: 'rejected', reason: error }]).complete) failures.push(failure);
      samples.push([]);
    }
  }
  const complete = failures.length === 0;
  const detected = complete && samples.every(s => s.length > 0) && JSON.stringify(samples[0]) === JSON.stringify(samples[1]);
  return { version: 1, complete, failures, detected, addresses: detected ? samples[0] : [], fingerprint: createHash('sha256').update(JSON.stringify({ samples, failures: failures.map(f => f.reason) })).digest('hex'), controls: 2, note: 'Matching DNS does not establish a distinct host, common ownership or network authorization. Incomplete controls cannot disprove wildcard DNS.' };
}
