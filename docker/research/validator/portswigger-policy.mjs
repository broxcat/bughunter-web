import { z } from 'zod';
import { normalizeFqdn, matchesHost } from '../../../src/lib/bountyProgram.ts';
import { enforceHttp1, enforceHttp2, activeObservation } from './burp-active.mjs';
import { sanitizeHistoryItem } from './burp-http.mjs';
import { BurpTransportError, sendViaBurpProxy } from './burp-transport.mjs';
const paging = z.object({ count: z.number().int().min(1).max(20), offset: z.number().int().min(0).max(10000), regex: z.string().max(500).optional() }).strict();
const histories = new Set(['get_proxy_http_history', 'get_proxy_http_history_regex', 'get_organizer_items', 'get_organizer_items_regex']);
const utilities = new Set(['url_encode', 'url_decode', 'base64_encode', 'base64_decode', 'generate_random_string']);
export function allowedHistoryHost(host, p) {
  try { if (normalizeFqdn(host) !== host || host.includes('*')) return false; } catch { return false; }
  if (p.programScope?.exclusions.some(rule => matchesHost(host, rule))) return false;
  return p.mode === 'PROGRAM_PASSIVE' ? Boolean(p.programScope?.rules.some(rule => matchesHost(host, rule))) : host === p.targetHost;
}
export function toolPolicy(name, p) {
  if (histories.has(name) || utilities.has(name)) return 'Scoped, redacted read or bounded local utility';
  if (['send_http1_request', 'send_http2_request', 'create_repeater_tab', 'create_repeater_tab_http2'].includes(name) && p.mode !== 'PROGRAM_PASSIVE') return 'Exact authorized host only; enforced User-Agent; no automatic retry';
  return 'Blocked by BugHunter policy: no applicable permission or no independently verifiable per-target attribution';
}
export async function callScopedPortSwigger(connection, name, input, p, { send = sendViaBurpProxy } = {}) {
  if (toolPolicy(name, p).startsWith('Blocked')) throw new Error('TOOL_NOT_ALLOWED');
  if (histories.has(name)) {
    const args = paging.parse(input);
    // Never run a user-supplied regex in Burp (unbounded regex cost). Fetch a
    // bounded page, then authorize every record locally. No bodies/credentials.
    const upstreamName = name.includes('organizer') ? 'get_organizer_items' : 'get_proxy_http_history';
    const result = await connection.call(upstreamName, { count: args.count, offset: args.offset });
    if (result.isError) throw new Error('UPSTREAM_ERROR');
    const items = []; let bytes = 0, skipped = 0;
    for (const block of result.content ?? []) {
      if (block.type !== 'text') continue;
      bytes += Buffer.byteLength(block.text); if (bytes > 150000) throw new Error('UPSTREAM_LIMIT');
      if (/access denied by Burp Suite/.test(block.text)) throw new Error('HISTORY_ACCESS_DENIED');
      for (const part of block.text.split('\n\n').slice(0, 21)) {
        if (part === 'Reached end of items') continue;
        try {
          const raw = JSON.parse(part), hosts = [...raw.request.matchAll(/^Host:[ \t]*([^\r\n]+)$/gim)];
          if (hosts.length !== 1) { skipped++; continue; }
          const host = hosts[0][1].trim().toLowerCase().replace(/:(?:80|443)$/, '');
          const item = allowedHistoryHost(host, p) ? sanitizeHistoryItem(raw, { ...p, targetHost: host }) : null;
          // Regex is a literal filter on the already redacted, authorized result.
          if (item && (!args.regex || JSON.stringify(item).includes(args.regex))) items.push(item); else skipped++;
        } catch { skipped++; }
      }
    }
    return { source: 'PortSwigger MCP', items, skipped, untrustedData: true, findingCreated: false,
      note: 'Bounded authorized-host metadata. Regex is a literal filter on redacted metadata. HTTP Host is not proof of destination; scheme is the authorization snapshot. WebSocket payloads lack host attribution upstream and are blocked.' };
  }
  if (utilities.has(name)) {
    if (Buffer.byteLength(JSON.stringify(input)) > 8192 || (name === 'generate_random_string' && (!Number.isInteger(input.length) || input.length < 1 || input.length > 4096))) throw new Error('UNSAFE_REQUEST');
    return connection.call(name, input);
  }
  const repeater = name.startsWith('create_repeater_tab'), http2 = name.endsWith('http2') || name === 'send_http2_request';
  const { tabName, ...request } = input;
  if (tabName !== undefined && tabName !== null && (typeof tabName !== 'string' || tabName.length > 100 || /[\x00-\x1f]/.test(tabName))) throw new Error('UNSAFE_REQUEST');
  const args = http2 ? enforceHttp2(request, p) : enforceHttp1(request, p);
  if (!allowedHistoryHost(args.targetHostname, p)) throw new Error('OUT_OF_SCOPE');
  if (!repeater && !(http2 && p.scheme === 'http')) return send(name, args, p);
  if (repeater && tabName != null) args.tabName = tabName;
  const result = await connection.call(name, args);
  if (result.isError) throw new BurpTransportError('BURP_TOOL_ERROR');
  return activeObservation(result, p);
}
