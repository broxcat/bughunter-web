import { Redis } from "ioredis";
import { logger } from "@/lib/logger";

export type RateLimitResult =
  | { status: "ALLOWED"; remaining: number; resetSec: number }
  | { status: "BLOCKED"; remaining: number; resetSec: number }
  | { status: "UNAVAILABLE" };

// One atomic command cannot leave a counter without expiry on a process crash.
const WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

/** The caller chooses its outage policy. Never share BullMQ's blocking client. */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  let client: Redis | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      lazyConnect: true, maxRetriesPerRequest: 0, enableOfflineQueue: false,
      connectTimeout: 500, commandTimeout: 500, retryStrategy: () => null,
    });
    client.on("error", () => {}); // Never log raw Redis errors/URLs or identity keys.
    const connection = client;
    const [count, ttl] = await Promise.race([
      (async () => {
        await connection.connect();
        return await connection.eval(WINDOW_SCRIPT, 1, key, windowSec) as [number, number];
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Limiter deadline")), 1000); }),
    ]);
    return { status: count <= limit ? "ALLOWED" : "BLOCKED", remaining: Math.max(0, limit - count), resetSec: Math.max(1, ttl) };
  } catch {
    logger.warn({ code: "RATE_LIMIT_UNAVAILABLE" }, "anti-abuse backend unavailable; operation policy required");
    return { status: "UNAVAILABLE" };
  } finally {
    clearTimeout(timer);
    client?.disconnect();
  }
}
