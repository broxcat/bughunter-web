import { z } from 'zod';
import { safeObservationUrl, redactObservationText } from '../../../src/lib/observationSafety.ts';
import { matchesHost, normalizeFqdn } from '../../../src/lib/bountyProgram.ts';
const text = max => z.string().max(max);
const destination = { targetHostname: text(253), targetPort: z.number().int().min(1).max(65535), usesHttps: z.boolean() };
export const http1Arguments = z.strictObject({ ...destination, content: text(65536) });
export const http2Arguments = z.strictObject({ ...destination, pseudoHeaders: z.record(text(100), text(4096)), headers: z.record(text(100), text(4096)), requestBody: text(65536) });
function destinationCheck(a, p) {
  if (p.mode === 'PROGRAM_PASSIVE') throw new Error('TOOL_NOT_ALLOWED');
  a.targetHostname = normalizeFqdn(a.targetHostname);
  if (a.targetHostname !== p.targetHost || a.targetPort !== p.port || a.usesHttps !== (p.scheme === 'https')) throw new Error('OUT_OF_SCOPE');
  if (p.programScope?.exclusions.some(rule => matchesHost(a.targetHostname, rule))) throw new Error('OUT_OF_SCOPE');
}
function authority(value, p) { return value === p.targetHost || value === `${p.targetHost}:${p.port}`; }
function pathCheck(value, p) {
  if (!value || /[\x00-\x20\x7f\\]/.test(value) || value.startsWith('//') || value.includes('#')) throw new Error('UNSAFE_REQUEST');
  if (value.startsWith('/')) return;
  let u; try { u = new URL(value); } catch { throw new Error('UNSAFE_REQUEST'); }
  if (u.hostname !== p.targetHost || u.protocol !== `${p.scheme}:` || Number(u.port || (u.protocol === 'https:' ? 443 : 80)) !== p.port || u.username || u.password) throw new Error('OUT_OF_SCOPE');
}
export function enforceHttp1(input, p) {
  const a = http1Arguments.parse(input); destinationCheck(a, p);
  if (Buffer.byteLength(a.content) > 65536 || a.content.includes('\0')) throw new Error('UNSAFE_REQUEST');
  const split = /\r?\n\r?\n/.exec(a.content); if (!split) throw new Error('UNSAFE_REQUEST');
  const head = a.content.slice(0, split.index), body = a.content.slice(split.index + split[0].length);
  // PortSwigger 1.3.0 normalizes literal \\r/\\n in the prelude. Reject those
  // spellings so its normalization cannot inject a header after our validation.
  if (/\\[rn]/.test(head)) throw new Error('UNSAFE_REQUEST');
  const lines = head.split(/\r?\n/), match = /^([A-Z]{1,20}) (\S+) HTTP\/1\.[01]$/.exec(lines.shift() ?? '');
  if (!match || ['CONNECT','PRI'].includes(match[1])) throw new Error('UNSAFE_REQUEST'); pathCheck(match[2], p);
  const headers = [], names = new Set();
  for (const line of lines) {
    const h = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*([^\r\n]*)$/.exec(line); if (!h || /[\x00-\x08\x0b-\x1f\x7f]/.test(h[2])) throw new Error('UNSAFE_REQUEST');
    const name = h[1].toLowerCase();
    if (['host','content-length','transfer-encoding'].includes(name) && names.has(name)) throw new Error('UNSAFE_REQUEST'); names.add(name);
    if (name === 'host' && !authority(h[2].trim(), p)) throw new Error('OUT_OF_SCOPE');
    if (['transfer-encoding','upgrade'].includes(name)) throw new Error('UNSAFE_REQUEST');
    if (!['host','user-agent','content-length','connection','proxy-connection'].includes(name)) headers.push(`${h[1]}: ${h[2]}`);
  }
  headers.unshift(`Host: ${p.targetHost}`, `User-Agent: ${p.requiredUserAgent}`);
  if (body || names.has('content-length')) headers.push(`Content-Length: ${Buffer.byteLength(body)}`);
  return { ...a, content: `${match[0]}\r\n${headers.join('\r\n')}\r\n\r\n${body}` };
}
export function enforceHttp2(input, p) {
  const a = http2Arguments.parse(input); destinationCheck(a, p);
  const pseudoHeaders = {}, headers = {};
  for (const [key, value] of Object.entries(a.pseudoHeaders)) {
    const name = key.startsWith(':') ? key : `:${key}`;
    if (![':authority',':scheme',':method',':path'].includes(name) || name in pseudoHeaders || /[\r\n\0]/.test(value)) throw new Error('UNSAFE_REQUEST'); pseudoHeaders[name] = value;
  }
  if (!authority(pseudoHeaders[':authority'], p) || pseudoHeaders[':scheme'] !== p.scheme) throw new Error('OUT_OF_SCOPE');
  if (!/^[A-Z]{1,20}$/.test(pseudoHeaders[':method'] ?? '') || ['CONNECT','PRI'].includes(pseudoHeaders[':method'])) throw new Error('UNSAFE_REQUEST'); pathCheck(pseudoHeaders[':path'], p);
  if (!pseudoHeaders[':path'].startsWith('/')) throw new Error('UNSAFE_REQUEST');
  if (Object.keys(a.headers).length > 100) throw new Error('UNSAFE_REQUEST');
  for (const [key, value] of Object.entries(a.headers)) {
    const name = key.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || /[\x00-\x08\x0a-\x1f\x7f]/.test(value) || ['connection','transfer-encoding','upgrade'].includes(name) || name in headers) throw new Error('UNSAFE_REQUEST');
    if (name === 'host' && !authority(value, p)) throw new Error('OUT_OF_SCOPE');
    if (!['user-agent','host','content-length'].includes(name)) headers[name] = value;
  }
  headers['user-agent'] = p.requiredUserAgent; if (a.requestBody) headers['content-length'] = String(Buffer.byteLength(a.requestBody));
  pseudoHeaders[':authority'] = p.targetHost;
  return { ...a, pseudoHeaders, headers };
}
// Response snippets are untrusted and redacted, never persisted automatically.
export function activeObservation(result, p) {
  const raw = result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') ?? '';
  if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error('UPSTREAM_LIMIT');
  const status = /^HTTP\/(?:1\.[01]|2) ([1-5][0-9]{2})(?: |\r|\n|$)/.exec(raw);
  return { source: 'BURP_MCP', targetHost: p.targetHost, observedAt: new Date().toISOString(), classification: 'OBSERVATION', findingCreated: false,
    transportResult: result.isError ? 'BURP_TOOL_ERROR' : status ? 'TARGET_HTTP_RESPONSE' : 'BURP_TOOL_RESPONSE', remoteStatus: result.isError ? null : status ? Number(status[1]) : null,
    networkDestinationVerified: false, untrustedData: true, response: redactObservationText(raw).replace(/https?:\/\/[^\s<>"`]+/gi, u => safeObservationUrl(u)).slice(0, 16384),
    truncated: raw.length > 16384, upstreamError: Boolean(result.isError), note: 'A response/status/reflection is not a vulnerability. Retain only minimal redacted reproducible evidence under requests/. No redirect was automatically replayed by this gateway.' };
}
