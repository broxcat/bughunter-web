// Standalone Node-only acceptance used in Docker RUN --network=none and CI.
// All active binaries receive ONLY ephemeral 127.0.0.1 fixture URLs/ports.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createSocket } from 'node:dgram';
import { Resolver } from 'node:dns/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const execute = promisify(execFile), directory = await mkdtemp(join(tmpdir(), 'recon-toolchain-'));
const binary = name => name !== 'nmap' && process.env.RECON_SMOKE_BIN ? join(process.env.RECON_SMOKE_BIN, name) : name;
const templates = process.env.RECON_SMOKE_TEMPLATES ?? join(process.cwd(), 'src/server/recon/templates');
const seen = [], results = [];
const dns = createSocket('udp4');
dns.on('message', (packet, remote) => {
  let offset = 12; const labels = [];
  while (packet[offset] && offset < packet.length) { const size = packet[offset++]; labels.push(packet.subarray(offset, offset + size).toString('ascii')); offset += size; }
  const name = labels.join('.'), type = packet.readUInt16BE(offset + 1);
  const found = type === 1 && (name === 'api.local.recon.test' || name.endsWith('.wild.recon.test'));
  const reply = Buffer.from(packet.subarray(0, offset + 5)); reply.writeUInt16BE(0, 8); reply.writeUInt16BE(0, 10); reply[2] = 0x81; reply[3] = found ? 0x80 : 0x83; reply.writeUInt16BE(found ? 1 : 0, 6);
  const answer = Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 127, 0, 0, 1]);
  dns.send(found ? Buffer.concat([reply, answer]) : reply, remote.port, remote.address);
});
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://fixture.invalid'); seen.push({ path: url.pathname, userAgent: req.headers['user-agent'] });
  res.setHeader('Content-Type', 'text/html'); res.setHeader('Server', 'nginx');
  if (url.pathname === '/http/redirect') { res.statusCode = 302; res.setHeader('Location', '/http/'); res.end(); return; }
  if (url.pathname === '/http/protected') { res.statusCode = 401; res.setHeader('WWW-Authenticate', 'Bearer realm="local fixture"'); res.end('protected'); return; }
  if (url.pathname === '/http/') { res.end('<title>Local fixture</title>'); return; }
  if (url.pathname === '/surface') { res.statusCode = 401; res.setHeader('WWW-Authenticate', 'Bearer'); res.end('<title>Login</title><form><input type="password"></form>{"openapi":"3.0.0","paths":{}}'); return; }
  const mode = url.pathname.split('/')[1], leaf = url.pathname.split('/').at(-1);
  if (['admin', 'api', 'login'].includes(leaf) && !(mode === 'redirect307' && leaf === 'admin')) { res.end(`<title>Observed ${leaf}</title>Useful known ${leaf} route`); return; }
  if (mode === 'real404') { res.statusCode = 404; res.end('Not found'); }
  else if (mode === 'redirect302' || mode === 'redirect307') { res.statusCode = mode === 'redirect302' ? 302 : 307; res.setHeader('Location', '/login?callbackUrl=' + encodeURIComponent(url.pathname)); res.end(); }
  else if (mode === 'variable') res.end(`<title>Unknown</title>Missing ${url.pathname} nonce ${randomUUID()}`);
  else if (mode === 'constant') res.end('Missing resource');
  else res.end('<title>Unknown</title>Nothing here.');
});
const run = async (tool, args, allowFailure = false) => {
  assert(!args.some(a => /https?:\/\//i.test(a) && !a.startsWith('http://127.0.0.1:')), 'Non-local tool target rejected');
  try {
    const pending = execute(binary(tool), args, { timeout: 45000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', NO_PROXY: '*' } });
    pending.child?.stdin?.end();
    const result = await pending;
    assert(!/WARNING: sonic\/ast|fallback to encoding\/json/.test(result.stdout + result.stderr), `${tool}: incompatible Sonic runtime warning`);
    return { ...result, code: 0 };
  } catch (error) {
    if (!allowFailure || error.killed) throw error;
    assert(!/WARNING: sonic\/ast|fallback to encoding\/json/.test((error.stdout ?? '') + (error.stderr ?? '')), `${tool}: incompatible Sonic runtime warning`);
    return { stdout: error.stdout ?? '', stderr: error.stderr ?? '', code: error.code };
  }
};
const lines = output => output.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line));
try {
  await new Promise(resolve => dns.bind(0, '127.0.0.1', resolve));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port, origin = `http://127.0.0.1:${port}`;
  const paths = join(directory, 'urls.txt'); await writeFile(paths, ['/http/', '/http/redirect', '/http/protected'].map(p => origin + p).join('\n') + '\n');
  const http = await run('httpx', ['-l', paths, '-silent', '-json', '-sc', '-title', '-ct', '-location', '-nfs', '-duc', '-threads', '1', '-rl', '10', '-timeout', '3', '-retries', '0', '-H', 'User-Agent: BugHunter-Toolchain/2']);
  const httpRows = lines(http.stdout); assert.deepEqual(httpRows.map(r => r.status_code).sort(), [200, 302, 401]); assert(httpRows.some(r => r.location === '/http/')); results.push({ tool: 'httpx', status: 'READY', responses: httpRows.length });
  const words = join(directory, 'words.txt'); await writeFile(words, 'admin\napi\nlogin\nunknown-word\n');
  const ffufArgs = prefix => ['-u', origin + prefix + 'FUZZ', '-w', words, '-json', '-s', '-noninteractive', '-ac', '-t', '1', '-rate', '10', '-timeout', '3', '-maxtime', '20', '-maxtime-job', '20', '-mc', 'all', '-H', 'User-Agent: BugHunter-Toolchain/2'];
  const ffuf = lines((await run('ffuf', ffufArgs('/real404/'))).stdout); assert(['admin', 'api', 'login'].every(path => ffuf.some(r => r.url?.endsWith('/' + path)))); assert(!ffuf.some(r => r.url?.endsWith('/unknown-word')));
  const fallback = lines((await run('ffuf', ffufArgs('/redirect307/'))).stdout); assert(fallback.some(r => r.url?.endsWith('/api'))); assert(!fallback.some(r => r.status === 307 || r.url?.endsWith('/admin'))); results.push({ tool: 'ffuf', status: 'READY', real404: ffuf.length, wildcard307: fallback.length });
  const gobusterArgs = mode => ['dir', '-u', origin + '/' + mode + '/', '-w', words, '--quiet', '--no-progress', '--no-color', '--expanded', '--threads', '1', '--delay', '50ms', '--timeout', '3s', '--useragent', 'BugHunter-Toolchain/2'];
  const good = await run('gobuster', gobusterArgs('real404')); assert(good.stdout.includes('/admin') && good.stdout.includes('(Status: 200)')); results.push({ tool: 'gobuster', fixture: 'REAL_404', status: 'READY' });
  for (const mode of ['soft200', 'redirect302', 'redirect307', 'constant', 'variable']) {
    const unknown = await run('gobuster', gobusterArgs(mode), true); assert.notEqual(unknown.code, 0, `${mode}: native Gobuster must refuse non-discriminating wildcard responses`);
    assert(/non existing|wildcard|matches the provided options|exclude/i.test(unknown.stdout + unknown.stderr), `${mode}: expected meaningful baseline refusal`);
    results.push({ tool: 'gobuster', fixture: mode, status: 'EXPECTED_BASELINE_REFUSAL' });
  }
  const adapted = await run('gobuster', [...gobusterArgs('redirect307'), '--exclude-length', '0']); assert(adapted.stdout.includes('/api') && !adapted.stdout.includes('(Status: 307)')); results.push({ tool: 'gobuster', fixture: 'redirect307 + reliable zero-length exclusion', status: 'READY' });
  const resolverAddress = '127.0.0.1:' + dns.address().port, dnsWords = join(directory, 'dns-words.txt'); await writeFile(dnsWords, 'api\nunknown\n');
  const resolver = new Resolver({ timeout: 1000, tries: 1 }); resolver.setServers([resolverAddress]);
  assert.deepEqual(await resolver.resolve4('anything.wild.recon.test'), ['127.0.0.1']);
  assert.deepEqual(await resolver.resolve4('api.local.recon.test'), ['127.0.0.1']);
  const dnsArgs = domain => ['dns', '--domain', domain, '--resolver', resolverAddress, '--protocol', 'udp', '-w', dnsWords, '--quiet', '--no-progress', '--no-color', '--threads', '1', '--delay', '50ms', '--timeout', '2s'];
  const exactDns = await run('gobuster', dnsArgs('local.recon.test')); assert(exactDns.stdout.includes('api.local.recon.test') && !exactDns.stdout.includes('unknown.local.recon.test'), exactDns.stdout + exactDns.stderr);
  const wildcardDns = await run('gobuster', dnsArgs('wild.recon.test'), true); assert.notEqual(wildcardDns.code, 0); assert(/wildcard/i.test(wildcardDns.stdout + wildcardDns.stderr));
  results.push({ tool: 'gobuster dns / native DNS resolver', status: 'READY', exact: true, wildcardDetected: true });
  const nmap = await run('nmap', ['-sT', '-Pn', '-n', '-p', String(port), '--max-retries', '0', '--host-timeout', '15s', '-oX', '-', '127.0.0.1']); assert(nmap.stdout.includes(`<port protocol="tcp" portid="${port}"><state state="open"`)); results.push({ tool: 'nmap', status: 'READY', openControlledPort: true });
  const ids = ['bughunter-recon-headers', 'bughunter-recon-auth', 'bughunter-recon-api', 'bughunter-recon-panel'];
  const nuclei = await run('nuclei', ['-u', origin + '/surface', '-t', ids.map(id => join(templates, id + '.yaml')).join(','), '-silent', '-jsonl', '-omit-raw', '-omit-template', '-dr', '-ni', '-duc', '-rl', '10', '-c', '1', '-bs', '1', '-timeout', '3', '-retries', '0', '-H', 'User-Agent: BugHunter-Toolchain/2']);
  const matches = lines(nuclei.stdout); for (const id of ids) assert(matches.some(r => r['template-id'] === id), `Safe Nuclei template did not execute/match: ${id}`); results.push({ tool: 'nuclei', status: 'READY', templateIds: ids, sonicWarning: false });
  assert(seen.length > 10); assert(seen.every(r => r.userAgent === 'BugHunter-Toolchain/2'), 'Every HTTP scanner/calibration request must carry the explicit fixture User-Agent');
  console.log(JSON.stringify({ schemaVersion: 1, status: 'READY', actualNativeTools: true, network: 'loopback-only', requests: seen.length, results }, null, 2));
} finally { dns.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
