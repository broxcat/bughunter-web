import { z } from 'zod';
import { matchesHost, normalizeFqdn } from './bountyProgram.ts';

export const ASSET_TYPES = ['API', 'WEB_APPLICATION', 'WILDCARD', 'OTHER'] as const;
export const ASSET_VALUES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
export type AssetType = typeof ASSET_TYPES[number];
export type AssetValue = typeof ASSET_VALUES[number];
export type AssetFormat = 'URL' | 'WILDCARD_DOMAIN' | 'DOMAIN' | 'SUBDOMAIN' | 'HOSTNAME' | 'IP' | 'CIDR';
export type AssetBoundary = { normalizedValue: string; format: string; active?: boolean };
export const assetTypeLabel: Record<AssetType, string> = { API: 'API', WEB_APPLICATION: 'Web Application', WILDCARD: 'Wildcard', OTHER: 'Other' };
export const assetValueLabel: Record<AssetValue, string> = { CRITICAL: 'Critical', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
export const assetValueRank = (value: string) => { const n = (ASSET_VALUES as readonly string[]).indexOf(value); return n < 0 ? 4 : n; };
function ip(value: string): string | null {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) return value.split('.').every(v => /^(0|[1-9]\d{0,2})$/.test(v) && Number(v) <= 255) ? value : null;
  if (value.includes(':')) { try { return new URL(`http://[${value.replace(/^\[|\]$/g, '')}]/`).hostname.slice(1, -1); } catch { return null; } }
  return null;
}
/** Only document escapes of '*' and '.' are removed. No general regex/unescape interpretation. */
export function detectScopeAsset(originalValue: string) {
  const value = originalValue.trim().replace(/\\([*.])/g, '$1');
  if (!value || value.length > 2048 || /[\s\x00-\x1f\x7f\\]/.test(value)) throw new Error('Enter one domain, wildcard, HTTP(S) URL, IP or CIDR; spaces and ambiguous escapes are unsupported');
  let normalizedValue: string, format: AssetFormat, hostname: string | null = null;
  if (/^https?:\/\//i.test(value)) {
    if (/%2e|%2f|%5c|%25/i.test(value.split(/[?#]/)[0])) throw new Error('Ambiguous encoded scope path');
    const u = new URL(value);
    if (u.username || u.password || u.search || u.hash || /%2e|%2f|%5c|%25/i.test(u.pathname)) throw new Error('Scope URLs must not contain credentials, queries, fragments or ambiguous encoded paths');
    const authority = value.split('/')[2];
    if (/[^\x00-\x7f]/.test(authority)) throw new Error('IDN must be supplied in its explicit ASCII/punycode form');
    hostname = u.hostname;
    if (!ip(hostname)) normalizeFqdn(hostname);
    normalizedValue = u.toString(); if (normalizedValue.length > 2048) throw new Error('Normalized URL is too long'); format = 'URL';
  } else if (value.includes('/')) {
    const parts = value.split('/'), address = ip(parts[0]);
    if (parts.length !== 2 || !address || !/^\d{1,3}$/.test(parts[1]) || Number(parts[1]) > (address.includes(':') ? 128 : 32)) throw new Error('Invalid CIDR');
    normalizedValue = `${address}/${Number(parts[1])}`; format = 'CIDR';
  } else if (ip(value)) { normalizedValue = ip(value)!; format = 'IP'; hostname = normalizedValue; }
  else if (!value.includes('.') && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value)) { normalizedValue = value.toLowerCase(); format = 'HOSTNAME'; hostname = normalizedValue; }
  else {
    normalizedValue = normalizeFqdn(value);
    format = normalizedValue.startsWith('*.') ? 'WILDCARD_DOMAIN' : normalizedValue.split('.').length > 2 ? 'SUBDOMAIN' : 'DOMAIN';
    hostname = normalizedValue.startsWith('*.') ? null : normalizedValue;
  }
  const inferredType: AssetType = format === 'WILDCARD_DOMAIN' ? 'WILDCARD' : /^api[.-]/i.test(hostname ?? '') ? 'API' : format === 'URL' || format === 'DOMAIN' || format === 'SUBDOMAIN' ? 'WEB_APPLICATION' : 'OTHER';
  // The current Research/execution identity supports FQDNs. IP/CIDR/single-label
  // assets are retained for scope documentation, never silently executed.
  const executable = ['WILDCARD_DOMAIN', 'DOMAIN', 'SUBDOMAIN'].includes(format) || (format === 'URL' && hostname !== null && !ip(hostname));
  return { originalValue, normalizedValue, format, hostname, inferredType, executable };
}
export function assetAllowsHost(boundary: AssetBoundary, hostname: string) {
  if (boundary.active === false) return false;
  try {
    if (boundary.format === 'URL') return new URL(boundary.normalizedValue).hostname === hostname;
    return ['DOMAIN', 'SUBDOMAIN', 'WILDCARD_DOMAIN'].includes(boundary.format) && matchesHost(normalizeFqdn(hostname), boundary.normalizedValue);
  } catch { return false; }
}
export function assetAllowsUrl(boundary: AssetBoundary, value: string) {
  try {
    const u = new URL(value);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || /[\\\x00-\x20\x7f]/.test(value) || /%2e|%2f|%5c|%25/i.test(value.split(/[?#]/)[0]) || !assetAllowsHost(boundary, u.hostname)) return false;
    if (boundary.format !== 'URL') return true;
    const allowed = new URL(boundary.normalizedValue), path = allowed.pathname.replace(/\/$/, '');
    return u.origin === allowed.origin && (!path || u.pathname === path || u.pathname.startsWith(`${path}/`));
  } catch { return false; }
}
export const assetInputSchema = z.strictObject({
  value: z.string().min(1).max(2048).refine(v => { try { detectScopeAsset(v); return true; } catch { return false; } }, 'Invalid or unsupported scope value'),
  type: z.enum(ASSET_TYPES).optional(), assetValue: z.enum(ASSET_VALUES).default('MEDIUM'),
});
export const assetEditSchema = z.strictObject({ type: z.enum(ASSET_TYPES).optional(), assetValue: z.enum(ASSET_VALUES).optional() }).refine(v => Object.keys(v).length > 0, 'Choose a type or asset value');
export function assetReconStatus(run: { status: string; outcome: string | null; finishedAt: string | Date | null } | null, now = Date.now()) {
  if (!run) return 'NOT_STARTED';
  if (run.status === 'QUEUED' || run.status === 'RUNNING' || run.status === 'CANCELLED') return run.status;
  if (run.outcome === 'PARTIAL') return 'PARTIAL';
  if (run.status !== 'COMPLETED' || run.outcome !== 'SUCCESS') return 'FAILED';
  return run.finishedAt && now - new Date(run.finishedAt).getTime() > 7 * 86400000 ? 'STALE' : 'COMPLETED';
}
