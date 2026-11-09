
import { setTimeout as delay } from 'node:timers/promises';
import { privateReferenceFingerprint } from '@/lib/crypto';
import type { ImportPlatform, PlatformConnectionInput } from '@/lib/platformConnections';
import { createRedisConnection } from '@/server/queue/connection';
import { ImportUnavailable, type Reader } from './types';

const sources = {
  HACKERONE: { api: 'https://api.hackerone.com', interval: 1250 },
  BUGCROWD: { api: 'https://hacker-api.bugcrowd.com', interval: 1100 },
  INTIGRITI: { api: 'https://api.intigriti.com', interval: 600 },
  YESWEHACK: { api: 'https://api.yeswehack.com', interval: 3000 },
} as const;

const TAKE = `
if redis.call('SET', KEYS[1], '1', 'NX', 'PX', ARGV[1]) then return 0 end
return math.max(1, redis.call('PTTL', KEYS[1]))
`;
const COOLDOWN = `
if redis.call('PTTL', KEYS[1]) < tonumber(ARGV[1]) then
  redis.call('SET', KEYS[1], '1', 'PX', ARGV[1])
end
return 1
`;

function authorization(credential: PlatformConnectionInput) {
  if (credential.platform === 'INTIGRITI') return 'Bearer ' + credential.token;
  const pair = credential.username + ':' + credential.token;
  return credential.platform === 'BUGCROWD' ? 'Token ' + pair : 'Basic ' + Buffer.from(pair).toString('base64');
}

function retryAfter(value: string | null) {
  const seconds = value && /^\d+$/.test(value) ? Number(value) : value ? Math.ceil((Date.parse(value) - Date.now()) / 1000) : NaN;
  return Number.isSafeInteger(seconds) && seconds >= 1 ? Math.min(seconds, 604800) : 60;
}

async function body(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new ImportUnavailable('manual');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > 1024 * 1024) throw new ImportUnavailable('manual');
      chunks.push(item.value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel().catch(() => {}); }
}

export function platformReader(platform: ImportPlatform, credential?: PlatformConnectionInput) {
  if (credential ? credential.platform !== platform : platform !== 'YESWEHACK') throw new ImportUnavailable('connection_required');
  const source = sources[platform];
  const authHeader = credential ? authorization(credential) : undefined;
  const apiIdentity = credential ? privateReferenceFingerprint('platform-import-rate', credential.platform + ':' +
    (credential.platform === 'BUGCROWD' ? credential.username : credential.token)) : 'anonymous';
  const deadline = AbortSignal.timeout(25000);
  const redis = createRedisConnection({
    maxRetriesPerRequest: 0, retryStrategy: () => null, connectTimeout: 600, commandTimeout: 750,
  });
  redis.removeAllListeners('error');
  redis.on('error', () => {}); // Never log upstream identity or Redis credentials.
  const read: Reader = async path => {
    const origin = source.api;
    if (!origin || !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*(?:\?[A-Za-z0-9%&=]+)?$/.test(path)) throw new ImportUnavailable('manual');
    const url = new URL(path, origin);
    if (url.origin !== origin || url.username || url.password || url.hash) throw new ImportUnavailable('manual');
    const key = 'platform-import:' + platform + ':' + apiIdentity;
    try {
      for (;;) {
        deadline.throwIfAborted();
        const wait = Number(await redis.eval(TAKE, 1, key, source.interval));
        if (wait === 0) break;
        if (!Number.isFinite(wait) || wait < 1) throw new ImportUnavailable('temporarily_unavailable');
        if (wait > 3500) throw new ImportUnavailable('rate_limited', Math.ceil(wait / 1000));
        await delay(wait, undefined, { signal: deadline });
      }
    } catch (error) {
      if (error instanceof ImportUnavailable) throw error;
      throw new ImportUnavailable('temporarily_unavailable');
    }
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (authHeader) headers.Authorization = authHeader;
    const response = await fetch(url, {
      method: 'GET', headers, redirect: 'manual', cache: 'no-store',
      signal: AbortSignal.any([deadline, AbortSignal.timeout(6500)]),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 429) {
        const seconds = retryAfter(response.headers.get('Retry-After'));
        await redis.eval(COOLDOWN, 1, key, seconds * 1000);
        throw new ImportUnavailable('rate_limited', seconds);
      }
      if ([401, 403].includes(response.status) && credential) throw new ImportUnavailable('connection_required');
      throw new ImportUnavailable(response.status >= 500 ? 'temporarily_unavailable' : 'manual');
    }
    const type = response.headers.get('Content-Type') ?? '';
    if (!/\bjson\b/i.test(type)) {
      await response.body?.cancel().catch(() => {});
      throw new ImportUnavailable('manual');
    }
    const text = await body(response);
    return JSON.parse(text);
  };
  return { read, close: () => redis.disconnect() };
}
