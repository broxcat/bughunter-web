// Adapter for PortSwigger/mcp-server v1.3.0. Never expose raw upstream text.
import { safeObservationUrl } from '../../../src/lib/observationSafety.ts';
import { assetAllowsUrl } from '../../../src/lib/scopeAssets.ts';
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function historyArguments(policy, count, offset, requestId) {
  // This prefilter is an optimization, NOT proof of the actual HTTP destination.
  if (requestId !== undefined && !/^[a-f0-9-]{36}$/i.test(requestId)) throw new Error('INVALID_INPUT');
  return { count, offset, regex: requestId ? `(?im)^X-BugHunter-Request-Id:[ \\t]*${escapeRegex(requestId)}[ \\t]*\\r?$` : `(?im)^Host:[ \\t]*${escapeRegex(policy.targetHost)}(?::(?:80|443))?[ \\t]*\\r?$` };
}
function headers(message) {
  if (typeof message !== 'string' || message.length > 6000) return null;
  const boundary = message.search(/\r?\n\r?\n/);
  if (boundary < 0) return null;
  const lines = message.slice(0, boundary).split(/\r?\n/), first = lines.shift();
  const values = new Map();
  for (const line of lines) {
    const match = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*([^\r\n]*)$/.exec(line);
    if (!match) return null; // ambiguous/folded headers fail closed
    const name = match[1].toLowerCase();
    values.set(name, [...(values.get(name) ?? []), match[2].trim()]);
  }
  return { first, values };
}
export function sanitizeHistoryItem(raw, policy) {
  if (!raw || typeof raw !== 'object') return null;
  const req = headers(raw.request), res = headers(raw.response);
  if (!req || !res) return null;
  const request = /^([A-Z]{3,12}) (\S{1,2048}) HTTP\/(?:1\.[01]|2)$/.exec(req.first);
  const response = /^HTTP\/(?:1\.[01]|2) ([1-5][0-9]{2})(?: |$)/.exec(res.first);
  const hosts = req.values.get('host') ?? [];
  if (!request || !response || hosts.length !== 1) return null;
  const allowedPort = String(policy.port ?? (policy.scheme === 'https' ? 443 : 80));
  if (hosts[0].toLowerCase() !== policy.targetHost && hosts[0].toLowerCase() !== `${policy.targetHost}:${allowedPort}`) return null;
  let url;
  try {
    const path = request[2];
    if (!path.startsWith('/') && !/^https?:\/\//.test(path)) return null;
    if (path.startsWith('//') || /[\\#\x00-\x20\x7f]/.test(path)) return null;
    url = new URL(path, `${policy.scheme}://${policy.targetHost}:${allowedPort}`);
    if (url.hostname !== policy.targetHost || Number(url.port || (policy.scheme === 'https' ? 443 : 80)) !== Number(allowedPort) || url.protocol !== `${policy.scheme}:` || url.username || url.password) return null;
    if (policy.assetScope && !assetAllowsUrl(policy.assetScope, url.href)) return null;
  } catch { return null; }
  const ua = req.values.get('user-agent') ?? [];
  const ids = req.values.get('x-bughunter-request-id') ?? [];
  const locations = res.values.get('location') ?? [];
  let crossHostRedirect = false;
  for (const location of locations) {
    try { if (new URL(location, url).hostname !== policy.targetHost) crossHostRedirect = true; }
    catch { crossHostRedirect = true; }
  }
  const mime = (res.values.get('content-type')?.[0] ?? '').split(';')[0].toLowerCase();
  return {
    url: safeObservationUrl(url.href), method: request[1], status: Number(response[1]),
    contentType: ['application/json', 'text/html', 'text/plain', 'application/javascript', 'text/css', 'application/xml'].includes(mime) ? mime : 'other',
    authenticatedMaterialPresent: req.values.has('authorization') || req.values.has('cookie'),
    setsCookie: res.values.has('set-cookie'), requiredUserAgentMatches: ua.length === 1 && ua[0] === policy.requiredUserAgent,
    ...(ids.length === 1 && /^[a-f0-9-]{36}$/i.test(ids[0]) ? {requestId:ids[0]} : {}),
    crossHostRedirect, networkDestinationVerified: false,
  };
}
export function parseHistory(result, policy) {
  if (result.isError || !Array.isArray(result.content)) throw new Error('UPSTREAM_ERROR');
  const observations = []; let skipped = 0, bytes = 0;
  for (const block of result.content) {
    if (block.type !== 'text' || typeof block.text !== 'string') continue;
    bytes += Buffer.byteLength(block.text);
    if (bytes > 150000) throw new Error('UPSTREAM_LIMIT');
    if (block.text.includes('HTTP history access denied by Burp Suite')) throw new Error('HISTORY_ACCESS_DENIED');
    for (const part of block.text.split('\n\n').slice(0, 21)) {
      if (part === 'Reached end of items') continue;
      let item;
      try { item = sanitizeHistoryItem(JSON.parse(part), policy); } catch { /* v1.3.0 can truncate JSON: skip, never repair/invent */ }
      if (item && observations.length < 20) observations.push(item); else skipped++;
    }
  }
  return { observations, skipped };
}
