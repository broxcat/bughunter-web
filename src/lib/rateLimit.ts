import { createRedisConnection } from "@/server/queue/connection";
import { logger } from "@/lib/logger";

// Dedicated connection for rate limiting. The shared BullMQ client uses
// `maxRetriesPerRequest: null`, which makes ioredis queue a command FOREVER while
// disconnected rather than rejecting it — so a command issued during a Redis
// outage never rejects, the fail-open catch below never runs, and the request
// hangs until the client/proxy times out. This connection overrides that with a
// finite retry + a hard commandTimeout, so a command rejects within ~1s when
// Redis is down and the limiter genuinely fails open.
const globalForRl = globalThis as unknown as {
  rlRedis?: ReturnType<typeof createRedisConnection>;
};
const rlRedis =
  globalForRl.rlRedis ??
  createRedisConnection({ maxRetriesPerRequest: 1, commandTimeout: 1000 });
if (process.env.NODE_ENV !== "production") globalForRl.rlRedis = rlRedis;

export interface RateLimitResult {
  /** Whether this request is within the window's budget. */
  allowed: boolean;
  /** Requests left in the current window (0 once the limit is hit). */
  remaining: number;
  /** Seconds until the window resets — suitable for a `Retry-After` header. */
  resetSec: number;
}

/**
 * Redis fixed-window rate limiter.
 *
 * Counts requests per `key` in a window of `windowSec` seconds using INCR, and
 * sets the TTL (EXPIRE) only on the first hit of a window so the window is fixed
 * rather than sliding on every request.
 *
 * FAIL-OPEN BY DESIGN: if Redis is unreachable we allow the request and log a
 * warning. A rate limiter is a safety control, not an auth control — a Redis
 * blip must never lock legitimate users out of registration or login.
 *
 * Keys are namespaced by the caller, e.g. `rl:register:<ip>`.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  try {
    const count = await rlRedis.incr(key);

    // First request in this window: arm the TTL so the counter expires.
    if (count === 1) {
      await rlRedis.expire(key, windowSec);
      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        resetSec: windowSec,
      };
    }

    let ttl = await rlRedis.ttl(key);
    // -1 = key exists but has no TTL (EXPIRE lost to a crash/race); -2 = gone.
    // Re-arm the TTL so a counter can never get stuck without expiry.
    if (ttl < 0) {
      await rlRedis.expire(key, windowSec);
      ttl = windowSec;
    }

    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetSec: ttl,
    };
  } catch (err) {
    logger.warn(
      { err, key },
      "rateLimit: Redis unavailable, failing open (allowing request)",
    );
    return { allowed: true, remaining: limit, resetSec: windowSec };
  }
}
