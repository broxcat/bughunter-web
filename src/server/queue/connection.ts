// Shared ioredis connection for BullMQ + the log pub/sub bus.
//
// BullMQ requires `maxRetriesPerRequest: null` on the connection it blocks on
// (otherwise it throws at startup). We stash the primary client on globalThis in
// dev so Next.js hot-reload doesn't leak a new socket on every change. Pub/sub
// needs its own dedicated connection (a client in subscriber mode can't issue
// normal commands), so `createRedisConnection()` is exported as a factory.

import { Redis, type RedisOptions } from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// Options every connection shares. `maxRetriesPerRequest: null` is mandatory for
// any connection BullMQ uses for blocking commands. `lazyConnect: true` defers
// the TCP connect until the first real command instead of at construction time,
// so importing this module (e.g. during `next build`, when Redis isn't running)
// never opens a socket and never logs ECONNREFUSED.
const baseOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  lazyConnect: true,
};

/**
 * Create a brand-new Redis connection. Use this for anything that needs its own
 * socket — e.g. a pub/sub subscriber, which cannot share the command connection.
 *
 * Every connection carries an `error` listener so a connection failure surfaces
 * as a log line rather than an unhandled 'error' event that could crash the
 * process (ioredis emits 'error' on each failed reconnect attempt).
 */
export function createRedisConnection(options: RedisOptions = {}): Redis {
  const client = new Redis(REDIS_URL, { ...baseOptions, ...options });
  client.on("error", (err) => {
    console.error("[redis] connection error:", err);
  });
  return client;
}

const globalForRedis = globalThis as unknown as {
  redis?: Redis;
};

/**
 * The shared primary Redis connection (used by the BullMQ Queue/Worker and for
 * publishing log lines). Singleton across hot-reloads in dev.
 */
export const redis: Redis = globalForRedis.redis ?? createRedisConnection();

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
