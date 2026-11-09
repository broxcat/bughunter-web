
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { createRedisConnection } from './queue/connection';

const LEASE_MS = 60_000;
// One token at a time. Redis time and the same atomic operation govern
// both the token bucket and the expiring in-flight slots.
const ACQUIRE = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local interval = tonumber(ARGV[1])
local last = tonumber(redis.call('GET', KEYS[1])) or -interval
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[2]) then return 50 end
local wait = last + interval - now
if wait > 0 then return wait end
redis.call('SET', KEYS[1], now, 'PX', ARGV[4])
redis.call('ZADD', KEYS[2], now + tonumber(ARGV[4]), ARGV[3])
redis.call('PEXPIRE', KEYS[2], ARGV[4])
return 0
`;

const keys = (programId: string) => {
  const prefix = `execution:{${programId}}`;
  return [prefix + ':last-request', prefix + ':in-flight'] as const;
};
type Limits = { requestsPerSecond: number; maxConcurrency: number };
type TrafficRedis = Pick<ReturnType<typeof createRedisConnection>, 'eval' | 'zrem'>;

const state = globalThis as typeof globalThis & { programTrafficRedis?: TrafficRedis };
function trafficRedis() {
  return state.programTrafficRedis ??= createRedisConnection({
    commandTimeout: 2000, connectTimeout: 1000, maxRetriesPerRequest: 0,
    autoResendUnfulfilledCommands: false,
  });
}

export async function acquireProgramTraffic(programId: string, limits: Limits, signal: AbortSignal, client = trafficRedis()) {
  const lease = randomUUID();
  for (;;) {
    signal.throwIfAborted();
    const wait = Number(await client.eval(ACQUIRE, 2, ...keys(programId), Math.ceil(1000 / limits.requestsPerSecond),
      limits.maxConcurrency, lease, LEASE_MS));
    if (!Number.isFinite(wait) || wait < 0) throw new Error('Shared program traffic controls unavailable');
    if (wait === 0) {
      if (!signal.aborted) return lease;
      await releaseProgramTraffic(programId, lease, client).catch(() => {});
      signal.throwIfAborted();
    }
    await setTimeout(Math.min(wait, 250), undefined, { signal });
  }
}

export async function releaseProgramTraffic(programId: string, lease: string, client = trafficRedis()) {
  await client.zrem(keys(programId)[1], lease);
}
