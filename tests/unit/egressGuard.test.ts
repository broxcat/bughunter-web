import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { classifyAddress, deniedHostname } from '@/server/egress/addressPolicy';
import { EgressError, parseLabAllowlist, pinnedLookup, resolveEgressTarget } from '@/server/egress/resolve';
import { assertProviderEndpoint, guardedConnect, guardedFetch, isOperatorEndpoint } from '@/server/egress/fetch';

const lookupOf = (...addresses: string[]) => vi.fn(async () => addresses.map(address => ({ address, family: address.includes(':') ? 6 : 4 })));

describe('egress address policy (C1)', () => {
  it('denies every non-public IPv4 class including CGNAT/tailnet and metadata', () => {
    for (const address of ['0.0.0.0', '0.1.2.3', '10.1.2.3', '100.64.0.1', '100.121.43.68', '100.100.100.200', '127.0.0.1', '127.255.255.254',
      '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.0.0.170', '192.0.2.1', '192.88.99.1', '192.168.1.1', '198.18.0.1',
      '198.51.100.7', '203.0.113.9', '224.0.0.251', '239.255.255.250', '240.0.0.1', '255.255.255.255', '168.63.129.16']) {
      expect(classifyAddress(address).allowed, address).toBe(false);
    }
    for (const address of ['93.184.216.34', '1.1.1.1', '8.8.8.8', '100.63.255.255', '100.128.0.1', '172.32.0.1', '11.0.0.1']) {
      expect(classifyAddress(address).allowed, address).toBe(true);
    }
  });
  it('denies non-global IPv6 and IPv4 smuggled through transition formats', () => {
    for (const address of ['::', '::1', '[::1]', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '::ffff:0:10.0.0.1', '::127.0.0.1',
      '64:ff9b::a9fe:a9fe', '64:ff9b::10.0.0.1', '64:ff9b:1::1', 'fe80::1', 'fe80::1%eth0', 'fc00::1', 'fd00:ec2::254', 'fec0::1', 'ff02::1',
      '2001:db8::1', '2001::1', '2002:7f00:1::1', '3fff::1', '100::1', '5f00::1', '0:0:0:0:0:ffff:7f00:0001', 'not-an-ip']) {
      expect(classifyAddress(address).allowed, address).toBe(false);
    }
    for (const address of ['2606:4700:4700::1111', '2a00:1450:4007:80f::200e', '::ffff:93.184.216.34', '64:ff9b::808:808']) {
      expect(classifyAddress(address).allowed, address).toBe(true);
    }
  });
  it('denies local and infrastructure hostnames independently of DNS', () => {
    for (const name of ['localhost', 'a.localhost', 'metadata.google.internal', 'metadata.goog', 'kubernetes.default.svc', 'db.internal', 'printer.local', 'x.home.arpa'])
      expect(deniedHostname(name), name).toBe(true);
    expect(deniedHostname('api.example.com')).toBe(false);
  });
});

describe('resolution and pinning (C1)', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('refuses a FQDN resolving to loopback, mixed public/private answers, empty answers and DNS timeouts', async () => {
    await expect(resolveEgressTarget('localtest.me', 443, { lookupAll: lookupOf('127.0.0.1') })).rejects.toThrow(/EGRESS_DESTINATION_BLOCKED.*loopback/);
    await expect(resolveEgressTarget('rebind.example', 443, { lookupAll: lookupOf('93.184.216.34', '169.254.169.254') })).rejects.toThrow(/link-local/);
    await expect(resolveEgressTarget('rebind.example', 443, { lookupAll: lookupOf('2606:4700:4700::1111', '::ffff:10.0.0.1') })).rejects.toThrow(/embedded-ipv4/);
    await expect(resolveEgressTarget('empty.example', 443, { lookupAll: lookupOf() })).rejects.toThrow(/EGRESS_DNS_FAILED/);
    await expect(resolveEgressTarget('slow.example', 443, { timeoutMs: 20, lookupAll: () => new Promise(() => {}) })).rejects.toThrow(/EGRESS_DNS_TIMEOUT/);
    await expect(resolveEgressTarget('fail.example', 443, { lookupAll: async () => { throw new Error('ENOTFOUND'); } })).rejects.toThrow(/EGRESS_DNS_FAILED/);
  });
  it('rejects alternative IPv4 spellings once the URL parser normalizes them', async () => {
    for (const url of ['http://2130706433/', 'http://0x7f.0.0.1/', 'http://0177.0.0.1/', 'http://127.1/', 'http://[::ffff:127.0.0.1]/'])
      await expect(guardedFetch(url, { lookupAll: lookupOf('93.184.216.34') })).rejects.toThrow(/EGRESS_DESTINATION_BLOCKED/);
  });
  it('resolves exactly once and pins the validated address (DNS rebinding cannot swap it)', async () => {
    const lookupAll = vi.fn()
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const target = await resolveEgressTarget('rebind.example', 80, { lookupAll });
    const lookup = pinnedLookup(target);
    const results: unknown[] = [];
    lookup('rebind.example', { all: true }, (...args) => results.push(args));
    lookup('rebind.example', undefined, (...args) => results.push(args));
    lookup('other.example', undefined, (...args) => results.push(args));
    expect(lookupAll).toHaveBeenCalledTimes(1);
    expect(results[0]).toEqual([null, [{ address: '93.184.216.34', family: 4 }]]);
    expect(results[1]).toEqual([null, '93.184.216.34', 4]);
    expect((results[2] as unknown[])[0]).toBeInstanceOf(EgressError);
  });
  it('lab exceptions are exact host:port=ip associations, never ranges or wildcards', async () => {
    const { entries, errors } = parseLabAllowlist('lab.example.test:8443=100.121.43.68, *.lab.test:80=10.0.0.1, lab.test=10.0.0.2, x:99999=10.0.0.3, lab2.test:80=10.0.0.0/8');
    expect([...entries.keys()]).toEqual(['lab.example.test:8443']);
    expect(errors).toHaveLength(4);
    vi.stubEnv('EGRESS_LAB_ALLOWLIST', 'lab.example.test:8443=100.121.43.68');
    const lookupAll = lookupOf('127.0.0.1');
    await expect(resolveEgressTarget('lab.example.test', 8443, { lookupAll })).resolves.toMatchObject({ address: '100.121.43.68', source: 'LAB_ALLOWLIST' });
    expect(lookupAll).not.toHaveBeenCalled();
    await expect(resolveEgressTarget('lab.example.test', 443, { lookupAll: lookupOf('100.121.43.68') })).rejects.toThrow(/BLOCKED/);
    await expect(resolveEgressTarget('other.lab.example.test', 8443, { lookupAll: lookupOf('100.121.43.68') })).rejects.toThrow(/BLOCKED/);
  });
});

describe('guarded HTTP transport (C1)', () => {
  let server: Server; let port: number; const seen: { host?: string; url?: string }[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push({ host: req.headers.host, url: req.url });
      if (req.url === '/redirect') { res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' }); res.end(); return; }
      res.setHeader('Set-Cookie', ['a=1', 'b=2']); res.end('pinned');
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
  afterEach(() => vi.unstubAllEnvs());

  it('blocks loopback targets by default, before any connection', async () => {
    const before = seen.length;
    await expect(guardedFetch(`http://127.0.0.1:${port}/`)).rejects.toThrow(/EGRESS_DESTINATION_BLOCKED/);
    await expect(guardedFetch(`http://evil.example:${port}/`, { lookupAll: lookupOf('127.0.0.1') })).rejects.toThrow(/EGRESS_DESTINATION_BLOCKED/);
    await expect(guardedConnect('evil.example', port, { lookupAll: lookupOf('10.0.0.1') })).rejects.toThrow(/private/);
    expect(seen.length).toBe(before);
  });
  it('connects to the pinned lab address with the original Host header and no DNS, and never follows redirects', async () => {
    vi.stubEnv('EGRESS_LAB_ALLOWLIST', `pinned.lab.test:${port}=127.0.0.1`);
    const lookupAll = vi.fn();
    const response = await guardedFetch(`http://pinned.lab.test:${port}/hello`, { lookupAll });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('pinned');
    expect(response.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    expect(seen.at(-1)).toEqual({ host: `pinned.lab.test:${port}`, url: '/hello' });
    expect(lookupAll).not.toHaveBeenCalled();
    const redirect = await guardedFetch(`http://pinned.lab.test:${port}/redirect`);
    expect(redirect.status).toBe(302);
    expect(seen.filter(s => s.url?.includes('meta-data'))).toHaveLength(0);
    await expect(guardedFetch(`http://pinned.lab.test:${port}/redirect`, { redirect: 'error' })).rejects.toThrow(/EGRESS_REDIRECT_REFUSED/);
  });
  it('rejects non-HTTP schemes and credentials in URLs', async () => {
    for (const url of ['file:///etc/passwd', 'gopher://example.com/', 'ftp://example.com/', 'http://u:p@example.com/'])
      await expect(guardedFetch(url)).rejects.toThrow(/EGRESS_INVALID_DESTINATION/);
  });
  it('honours cancellation before connecting', async () => {
    const controller = new AbortController(); controller.abort(new Error('cancelled'));
    await expect(guardedFetch('http://example.com/', { signal: controller.signal, lookupAll: lookupOf('93.184.216.34') })).rejects.toThrow(/cancelled/);
  });
});

describe('AI provider endpoints (M1)', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('allows private addresses only for the exact operator-defined origins', async () => {
    vi.stubEnv('OLLAMA_HOST', 'http://ollama:11434');
    vi.stubEnv('RESEARCH_EMBEDDING_URL', 'http://embed.internal:8080');
    expect(isOperatorEndpoint('http://ollama:11434/api/chat')).toBe(true);
    expect(isOperatorEndpoint('http://ollama:11435/api/chat')).toBe(false);
    expect(isOperatorEndpoint('https://ollama:11434/')).toBe(false);
    expect(isOperatorEndpoint('http://embed.internal:8080/api/embed')).toBe(true);
    await expect(assertProviderEndpoint('http://ollama:11434')).resolves.toBeUndefined();
    await expect(assertProviderEndpoint('http://169.254.169.254/latest', { lookupAll: lookupOf('169.254.169.254') })).rejects.toThrow(/BLOCKED/);
    await expect(assertProviderEndpoint('https://llm.attacker.example', { lookupAll: lookupOf('10.0.0.8') })).rejects.toThrow(/private/);
    await expect(assertProviderEndpoint('https://api.provider.example', { lookupAll: lookupOf('93.184.216.34') })).resolves.toBeUndefined();
  });
});
