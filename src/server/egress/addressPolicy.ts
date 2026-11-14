import { BlockList, isIP } from 'node:net';

/**
 * Destination address classification for every user- or target-influenced
 * outbound connection. Default: public unicast only.
 *
 * Sources: IANA IPv4/IPv6 Special-Purpose Address Registries (RFC 6890 and
 * successors), plus infrastructure endpoints that sit in otherwise public
 * space. IPv6 uses a positive rule (global unicast 2000::/3 only) followed by
 * the special-purpose denials inside it, so unknown/new ranges fail closed.
 * Transition formats that embed an IPv4 address (mapped, NAT64) are judged by
 * the embedded IPv4 address; deprecated tunnelling formats are refused.
 */
const DENIED_V4: readonly [string, number, string][] = [
  ['0.0.0.0', 8, 'this-network'],
  ['10.0.0.0', 8, 'private'],
  ['100.64.0.0', 10, 'shared-cgnat-tailnet'],
  ['127.0.0.0', 8, 'loopback'],
  ['169.254.0.0', 16, 'link-local-metadata'],
  ['172.16.0.0', 12, 'private'],
  ['192.0.0.0', 24, 'ietf-protocol'],
  ['192.0.2.0', 24, 'documentation'],
  ['192.31.196.0', 24, 'as112'],
  ['192.52.193.0', 24, 'amt'],
  ['192.88.99.0', 24, '6to4-relay'],
  ['192.168.0.0', 16, 'private'],
  ['192.175.48.0', 24, 'as112'],
  ['198.18.0.0', 15, 'benchmarking'],
  ['198.51.100.0', 24, 'documentation'],
  ['203.0.113.0', 24, 'documentation'],
  ['224.0.0.0', 4, 'multicast'],
  ['240.0.0.0', 4, 'reserved-broadcast'],
  // Public-space infrastructure control planes.
  ['168.63.129.16', 32, 'azure-wireserver'],
];
const DENIED_V6: readonly [string, number, string][] = [
  ['64:ff9b:1::', 48, 'local-nat64'],
  ['2001::', 23, 'ietf-protocol-teredo-orchid'],
  ['2001:db8::', 32, 'documentation'],
  ['2002::', 16, '6to4'],
  ['3fff::', 20, 'documentation'],
];
const v4 = new BlockList(), v6 = new BlockList(), global6 = new BlockList();
const v4Reasons: [BlockList, string][] = [], v6Reasons: [BlockList, string][] = [];
for (const [address, prefix, reason] of DENIED_V4) {
  v4.addSubnet(address, prefix, 'ipv4');
  const one = new BlockList(); one.addSubnet(address, prefix, 'ipv4'); v4Reasons.push([one, reason]);
}
for (const [address, prefix, reason] of DENIED_V6) {
  v6.addSubnet(address, prefix, 'ipv6');
  const one = new BlockList(); one.addSubnet(address, prefix, 'ipv6'); v6Reasons.push([one, reason]);
}
global6.addSubnet('2000::', 3, 'ipv6');

/** Hostnames that name control planes or the local machine regardless of DNS. */
const DENIED_NAMES = [/^localhost$/, /\.localhost$/, /^metadata$/, /^metadata\.google\.internal$/, /^metadata\.goog$/,
  /^instance-data(?:\.ec2\.internal)?$/, /^kubernetes(?:\.default(?:\.svc(?:\.cluster\.local)?)?)?$/, /\.internal$/, /\.local$/,
  /\.home\.arpa$/, /\.in-addr\.arpa$/, /\.ip6\.arpa$/];

export type AddressVerdict = { allowed: true; address: string; family: 4 | 6 } | { allowed: false; address: string; reason: string };

function expandV6(address: string): number[] | null {
  // Canonical 8x16-bit groups; accepts an embedded dotted IPv4 tail.
  let text = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (text.includes('%')) return null; // Zone identifiers never name a public peer.
  const tail = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const parts = tail[2].split('.').map(Number);
    if (parts.some(p => p > 255)) return null;
    text = tail[1] + ((parts[0] << 8) | parts[1]).toString(16) + ':' + ((parts[2] << 8) | parts[3]).toString(16);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [], rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...rest].map(g => /^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN);
  return groups.length === 8 && groups.every(Number.isFinite) ? groups : null;
}
const embeddedV4 = (g: number[], from: number) => `${g[from] >> 8}.${g[from] & 255}.${g[from + 1] >> 8}.${g[from + 1] & 255}`;

/** Classify one literal address. Anything unparsable is denied. */
export function classifyAddress(raw: string): AddressVerdict {
  const address = raw.replace(/^\[|\]$/g, '');
  const family = isIP(address);
  if (family === 4) {
    if (!v4.check(address, 'ipv4')) return { allowed: true, address, family: 4 };
    return { allowed: false, address, reason: v4Reasons.find(([list]) => list.check(address, 'ipv4'))?.[1] ?? 'reserved' };
  }
  if (family === 6) {
    const g = expandV6(address);
    if (!g) return { allowed: false, address, reason: 'unparsable-ipv6' };
    // ::ffff:a.b.c.d (mapped), ::a.b.c.d (compatible), ::ffff:0:a.b.c.d (translated), 64:ff9b::/96 (NAT64).
    const zeros = (n: number) => g.slice(0, n).every(x => x === 0);
    const viaV4 = zeros(5) && g[5] === 0xffff ? embeddedV4(g, 6)
      : zeros(4) && g[4] === 0xffff && g[5] === 0 ? embeddedV4(g, 6)
      : g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0) ? embeddedV4(g, 6) : null;
    if (viaV4) {
      const inner = classifyAddress(viaV4);
      return inner.allowed ? { allowed: true, address, family: 6 } : { allowed: false, address, reason: `embedded-ipv4:${inner.reason}` };
    }
    if (zeros(6)) return { allowed: false, address, reason: zeros(8) ? 'unspecified' : g[7] === 1 && zeros(7) ? 'loopback' : 'ipv4-compatible' };
    const canonical = g.map(x => x.toString(16)).join(':');
    if (!global6.check(canonical, 'ipv6')) return { allowed: false, address, reason: (g[0] & 0xfe00) === 0xfc00 ? 'unique-local' : (g[0] & 0xffc0) === 0xfe80 ? 'link-local' : (g[0] & 0xff00) === 0xff00 ? 'multicast' : 'not-global-unicast' };
    if (v6.check(canonical, 'ipv6')) return { allowed: false, address, reason: v6Reasons.find(([list]) => list.check(canonical, 'ipv6'))?.[1] ?? 'reserved' };
    return { allowed: true, address, family: 6 };
  }
  return { allowed: false, address, reason: 'not-an-ip-address' };
}

export function deniedHostname(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/\.$/, '');
  return DENIED_NAMES.some(pattern => pattern.test(name));
}
