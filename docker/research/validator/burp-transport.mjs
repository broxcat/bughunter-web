import { burpSettings } from './burp-settings.mjs';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { X509Certificate, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enforceHttp1, enforceHttp2, activeObservation } from './burp-active.mjs';
import { acquireResearchTraffic, mergeResearchHeaders } from './program-traffic.mjs';
import { burpEndpoint } from './burp-proxy.mjs';
import { matchesHost } from '../../../src/lib/bountyProgram.ts';

export class BurpTransportError extends Error {
  constructor(code, details = {}) { super(code); this.details = { transportResult: code, remoteStatus: null, ...details }; }
}
export function proxyEndpoint() {
  const settings = burpSettings();
  const host = settings.BURP_PROXY_HOST ?? '127.0.0.1', port = Number(settings.BURP_PROXY_PORT ?? 8080);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new BurpTransportError('BURP_PROXY_UNREACHABLE');
  return { host, port };
}
function authorize(args, policy, http2) {
  const normalized = http2 ? enforceHttp2(args, policy) : enforceHttp1(args, policy);
  // Existing workspaces may predate programScope. Their immutable exact-host
  // authorization still applies; when present exclusions always win.
  if (policy.programScope?.exclusions.some(rule => matchesHost(policy.targetHost, rule))) throw new Error('OUT_OF_SCOPE');
  return normalized;
}
async function proxyCa(proxy) {
  // Burp's documented internal HTTP site, reached through the configured proxy
  // socket. "burp" here is a proxy-local HTTP Host, never a Docker DNS lookup.
  return new Promise((resolve, reject) => {
    const req = request({ hostname: proxy.host, port: proxy.port, method: 'GET', path: 'http://burp/cert', headers: { Host: 'burp' }, timeout: 3000 }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 32768) req.destroy(new Error('CA_LIMIT')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => { try { if (res.statusCode !== 200) throw new Error(); const cert = new X509Certificate(Buffer.concat(chunks)); if (!cert.ca) throw new Error(); resolve(cert.toString()); } catch { reject(new BurpTransportError('BURP_PROXY_CA_UNAVAILABLE')); } });
    });
    req.on('timeout', () => req.destroy(new BurpTransportError('BURP_PROXY_UNREACHABLE')));
    req.on('error', () => reject(new BurpTransportError('BURP_PROXY_UNREACHABLE'))); req.end();
  });
}
// An observed proxy CONNECT response outranks curl's platform-dependent exit
// code: a peer that returned502 was reachable. No target HTTP is fabricated.
export function proxyFailureKind(code,connectStatus){
  return connectStatus&&connectStatus!==200?'TARGET_CONNECT_FAILURE':[5,7].includes(code)?'BURP_PROXY_UNREACHABLE':code===6?'TARGET_DNS_FAILURE':[35,51,58,60,77].includes(code)?'TARGET_TLS_FAILURE':code===28?'TARGET_TIMEOUT':'BURP_TOOL_ERROR';
}
const trailer = '\nBUGHUNTER_CURL_RESULT ';
function executeCurl(args, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/curl', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let size = 0, failure;
    const fail = code => { failure ??= new BurpTransportError(code); child.kill('SIGKILL'); };
    const timer = setTimeout(() => fail('TARGET_TIMEOUT'), timeoutMs);
    const cancel = () => fail('TARGET_CANCELLED');
    for (const signal of ['SIGTERM','SIGHUP','SIGINT']) process.once(signal, cancel);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 1024 * 1024) fail('UPSTREAM_LIMIT'); else chunks.push(chunk); });
    child.stderr.on('data', () => {}); // Never log command lines, headers or curl diagnostics.
    child.stdin.on('error', () => {}); child.stdin.end(body);
    child.once('error', () => { failure = new BurpTransportError('BURP_TRANSPORT_UNAVAILABLE'); });
    child.once('close', code => {
      clearTimeout(timer); for (const signal of ['SIGTERM','SIGHUP','SIGINT']) process.removeListener(signal, cancel);
      if (failure) return reject(failure);
      const output = Buffer.concat(chunks).toString('utf8'), at = output.lastIndexOf(trailer);
      const match = at < 0 ? null : /^(\d{3}) (\S+) (\d{3})\n$/.exec(output.slice(at + trailer.length));
      if (!match) return reject(new BurpTransportError('BURP_TOOL_ERROR'));
      const status = Number(match[1]), version = match[2], connectStatus = Number(match[3]);
      if (code !== 0 || !status) {
        const error = proxyFailureKind(code,connectStatus);
        return reject(new BurpTransportError(error, { proxyConnectStatus: connectStatus || null }));
      }
      let raw = output.slice(0, at);
      while (/^HTTP\/\S+ 1[0-9]{2}(?: |\r|\n)/.test(raw)) {
        const boundary = raw.search(/\r?\n\r?\n/); if (boundary < 0) break;
        raw = raw.slice(boundary + (/^\r\n/.test(raw.slice(boundary)) ? 4 : 2));
      }
      if (!/^HTTP\/\S+ [1-5][0-9]{2}(?: |\r|\n)/.test(raw)) return reject(new BurpTransportError('BURP_TOOL_ERROR'));
      resolve({ status, version, raw });
    });
  });
}
export async function sendViaBurpProxy(name, input, policy, { audit = value => { process.stderr.write(JSON.stringify(value) + '\n'); }, timeoutMs = 15000, acquire = acquireResearchTraffic } = {}) {
  const h2 = name === 'send_http2_request';
  // Policy validation precedes CA fetch, child creation or any other network I/O.
  const args = authorize(input, policy, h2), proxy = proxyEndpoint(), mcp = burpEndpoint(), requestId = randomUUID();
  const trace = { requestId, targetId: policy.targetId, destinationHost: policy.targetHost, destinationPort: policy.port, protocol: h2 ? 'HTTP/2' : 'HTTP/1.1', proxyHost: proxy.host, proxyPort: proxy.port, mcpHost: mcp.host, mcpPort: mcp.port, mcpTool: name };
  let directory, permit;
  try {
    let method, path, headers, body;
    if (h2) { method = args.pseudoHeaders[':method']; path = args.pseudoHeaders[':path']; headers = Object.entries(args.headers); body = args.requestBody; }
    else {
      const split = args.content.indexOf('\r\n\r\n'), lines = args.content.slice(0, split).split('\r\n');
      [method, path] = lines.shift().split(' '); headers = lines.map(line => { const at = line.indexOf(':'); return [line.slice(0,at), line.slice(at+1).trimStart()]; }); body = args.content.slice(split+4);
    }
    const origin = `${policy.scheme}://${policy.targetHost}:${policy.port}`;
    const parsed = path.startsWith('/') ? null : new URL(path);
    const requestPath = parsed ? parsed.pathname+parsed.search : path, url = origin+requestPath;
    headers = headers.filter(([key]) => !['user-agent','x-bughunter-request-id'].includes(key.toLowerCase()));
    headers.push(['X-BugHunter-Request-Id',requestId]);
    // -q must be first: a user curlrc must not enable redirects, retries,
    // credentials, alternate proxies or output files behind the policy gateway.
    const curl = ['-q','--silent','--show-error','--globoff','--path-as-is','--proto','=http,https','--proxy',`http://${proxy.host}:${proxy.port}`,'--noproxy','','--connect-timeout','5','--max-time',String(timeoutMs/1000),h2?'--http2-prior-knowledge':'--http1.1','--include','--suppress-connect-headers','--write-out',trailer+'%{http_code} %{http_version} %{http_connect}\n'];
    directory = await mkdtemp(join(tmpdir(),'bughunter-burp-request-'));
    const config = [['request',method],['request-target',policy.scheme==='http'?url:requestPath],['url',url]];
    if (policy.scheme === 'https') {
      const ca = await proxyCa(proxy);
      const file = join(directory,'ca.pem'); await writeFile(file,ca,{mode:0o600}); curl.push('--cacert',file);
    }
    permit = await acquire(policy, 'research-http', url);
    headers = Object.entries(mergeResearchHeaders(headers, permit.headers));
    for (const [key,value] of headers) config.push(['header',`${key}: ${value}`]);
    for (const key of ['Accept','Content-Type','Expect']) if (!headers.some(([name])=>name.toLowerCase()===key.toLowerCase())) config.push(['header',key+':']);
    if (body || headers.some(([key])=>key.toLowerCase()==='content-length')) { const file=join(directory,'body'); await writeFile(file,body,{mode:0o600}); config.push(['data-binary','@'+file]); }
    curl.push('--config','-');
    // Sensitive request headers/query/body never enter argv or structured logs.
    const response = await executeCurl(curl,config.map(([key,value])=>key+' = '+JSON.stringify(value)).join('\n')+'\n',timeoutMs+1000);
    if (h2 && response.version !== '2') throw new BurpTransportError('TARGET_PROTOCOL_UNSUPPORTED');
    const result = { ...activeObservation({content:[{type:'text',text:response.raw}]},policy), requestId, targetId: policy.targetId, transport: 'BURP_PROXY', transportResult: 'TARGET_HTTP_RESPONSE', remoteStatus: response.status, protocol: h2?'HTTP/2':'HTTP/1.1', responseOrigin: 'PROXIED_HTTP_RESPONSE', historyCapture: true };
    audit({ ...trace, transportResult: result.transportResult, remoteStatus: response.status }); return result;
  } catch (error) {
    const failure = error instanceof BurpTransportError ? error : new BurpTransportError(error.message === 'TOOL_NOT_ALLOWED' ? error.message : 'BURP_TOOL_ERROR');
    failure.details = { ...trace, ...failure.details }; audit(failure.details); throw failure;
  } finally { await permit?.release(); if (directory) await rm(directory,{recursive:true,force:true}); }
}
