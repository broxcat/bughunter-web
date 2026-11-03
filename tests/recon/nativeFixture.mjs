// Internal-network fixture only. No upstream DNS forwarding or public traffic.
import { createServer } from 'node:http';
import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
const observations = [];
const knownHosts = new Set(['recon.test', 'fixture.recon.test', 'api.recon.test']);
const ip = Object.values(networkInterfaces()).flat().find(n => n.family === 'IPv4' && !n.internal)?.address;
if (!ip) throw new Error('Fixture requires an internal IPv4 address');
const dns = createSocket('udp4');
dns.on('message', (query, peer) => {
  if (query.length < 17 || query.readUInt16BE(4) !== 1) return;
  let offset = 12; const labels = [];
  while (offset < query.length && query[offset]) {
    const size = query[offset++]; if (size > 63 || offset + size > query.length) return;
    labels.push(query.subarray(offset, offset + size).toString('ascii')); offset += size;
  }
  if (offset + 5 > query.length) return;
  offset++; const type = query.readUInt16BE(offset); offset += 4;
  const known = knownHosts.has(labels.join('.').toLowerCase());
  const answer = known && type === 1;
  const header = Buffer.alloc(12); query.copy(header, 0, 0, 2);
  header.writeUInt16BE(0x8480 | (query.readUInt16BE(2) & 0x0100) | (known ? 0 : 3), 2);
  header.writeUInt16BE(1, 4); header.writeUInt16BE(answer ? 1 : 0, 6);
  const record = answer ? Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 30, 0, 4, ...ip.split('.').map(Number)]) : Buffer.alloc(0);
  dns.send(Buffer.concat([header, query.subarray(12, offset), record]), peer.port, peer.address);
});
dns.bind(53, '0.0.0.0');
const knownPaths = new Set(['', 'login', 'register', 'auth/register', 'auth/reset-password', 'courses', 'private', 'client.js', 'openapi.json', 'swagger.json', 'api-docs', 'graphql', 'v1', 'v2', 'account', 'profile', 'admin', 'portal', 'status', 'health', 'api', 'docs', 'robots.txt', 'sitemap.xml', 'security.txt', 'dashboard', 'uploads', 'assets', 'config', 'version', 'debug', 'metrics', 'help', 'support', 'search', 'orders', 'billing', 'settings', 'auth', 'me', 'users', 'items', 'products', 'accounts', 'tenants', 'organizations', 'resources', 'capabilities', 'documentation', 'schema']);
createServer((req, res) => {
  if (req.url.startsWith('/__observations')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(observations)); return; }
  observations.push({ url: req.url, ua: req.headers['user-agent'], method: req.method });
  res.setHeader('Server', 'nginx'); res.setHeader('Set-Cookie', 'sid=PRIVATE_COOKIE; HttpOnly; SameSite=Lax');
  const parsed = new URL(req.url, 'http://fixture.recon.test');
  const path = parsed.pathname.replace(/^\/api(?:\/|$)/, '/').replace(/^\/|\/$/g, '');
  if (!knownPaths.has(path)) {
    if (process.env.RECON_NATIVE_WILDCARD_REDIRECT === 'true') { res.statusCode = 307; res.setHeader('Location', '/api/login?callbackUrl=' + encodeURIComponent(parsed.pathname)); res.end(); }
    else { res.statusCode = 404; res.end('Not found'); }
    return;
  }
  if (path === 'openapi.json' || path === 'swagger.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ openapi: '3.0.0', paths: { '/api/courses': { get: {} }, '/api/auth/reset-password': { get: {} } } })); return; }
  if (req.url === '/api/' || path === 'private') { res.statusCode = 401; res.setHeader('WWW-Authenticate', 'Bearer realm="fixture"'); }
  res.setHeader('Content-Type', 'text/html');
  res.end('<html><title>Local API portal</title>PRIVATE_BODY<a href="/api/login">login</a><a href="/api/register">register</a><a href="/api/auth/register">auth</a><a href="/api/auth/reset-password">reset</a><a href="/api/courses?q=private">courses</a><a href="/api/private">private</a><a href="/api/openapi.json">API specification</a><a href="http://outside.test/outside">outside host</a><a href="/api/delete">unsafe read</a><script src="/api/client.js"></script></html>');
}).listen(80, '0.0.0.0');
