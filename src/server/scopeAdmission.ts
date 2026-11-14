import { detectScopeAsset } from '@/lib/scopeAssets';
import { EgressError, parseLabAllowlist, resolveEgressTarget, type LookupAll } from './egress/resolve';

export class ScopeAdmissionError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); this.name = 'ScopeAdmissionError'; }
}

/**
 * M2: authorization is still attested by the owner, but a scope entry whose
 * name resolves to a non-public address (loopback, private, tailnet/CGNAT,
 * link-local/metadata, ...) is refused at admission. Unresolvable names are
 * admitted (programs list hosts that may not exist yet); execution re-checks
 * every connection through the egress guard, so admission is an early,
 * user-visible gate, not the enforcement point. Exact lab exceptions
 * (EGRESS_LAB_ALLOWLIST) are admitted for their host on any declared port.
 */
export async function assertPublicScopeValues(values: readonly string[], options: { lookupAll?: LookupAll; timeoutMs?: number; concurrency?: number } = {}) {
  const lab = new Set([...parseLabAllowlist().entries.keys()].map(key => key.slice(0, key.lastIndexOf(':'))));
  const checks: { value: string; host: string; port: number }[] = [];
  for (const value of new Set(values)) {
    let asset;
    try { asset = detectScopeAsset(value); } catch { continue; } // Format errors are reported by the input schema.
    if (!asset.executable) continue; // IP/CIDR/single-label entries are documentation only, never executed.
    const host = asset.format === 'WILDCARD_DOMAIN' ? asset.normalizedValue.slice(2) : asset.hostname;
    if (!host || lab.has(host)) continue;
    const port = asset.format === 'URL' ? Number(new URL(asset.normalizedValue).port || (asset.normalizedValue.startsWith('https:') ? 443 : 80)) : 443;
    checks.push({ value, host, port });
  }
  const refused: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < checks.length) {
      const { value, host, port } = checks[next++];
      try { await resolveEgressTarget(host, port, { lookupAll: options.lookupAll, timeoutMs: options.timeoutMs ?? 1500 }); }
      catch (error) { if (error instanceof EgressError && error.code === 'EGRESS_DESTINATION_BLOCKED') refused.push(value); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 16, checks.length) }, worker));
  if (refused.length) throw new ScopeAdmissionError(`Scope entries resolving to private, local or infrastructure addresses are refused: ${refused.slice(0, 5).join(', ')}${refused.length > 5 ? ` (+${refused.length - 5})` : ''}. An operator can declare an exact lab exception.`);
}
export function scopeAdmissionResponse(error: unknown) {
  return error instanceof ScopeAdmissionError ? Response.json({ error: error.message }, { status: error.status }) : null;
}
