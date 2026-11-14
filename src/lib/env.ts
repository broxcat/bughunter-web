// Startup environment contract. Fail fast with an actionable message instead of
// a cryptic error on the first encryption or auth call. Run from the Next.js
// boot hook (src/instrumentation.ts) and anywhere a clear precondition helps.

const HEX_64 = /^[0-9a-fA-F]{64}$/;

/**
 * Throw a clear, actionable Error if any required secret is missing or malformed.
 * Collects every problem so the operator sees all of them at once.
 *
 * - CREDENTIALS_ENCRYPTION_KEY: must be present and exactly 64 hex chars (the
 *   32-byte AES-256-GCM key used by src/lib/crypto.ts).
 * - AUTH_SECRET: must be present and non-empty (Auth.js session signing key).
 */
export function assertRequiredEnv(): void {
  const errors: string[] = [];

  for (const flag of ["TRUST_PROXY_HEADERS", "ALLOW_PUBLIC_REGISTRATION"]) {
    const value = process.env[flag];
    if (value !== undefined && value !== "true" && value !== "false") errors.push(`${flag} must be true or false.`);
  }
  const hops = process.env.TRUSTED_PROXY_HOPS ?? "1";
  if (!/^[1-9][0-9]?$/.test(hops) || Number(hops) > 16) errors.push("TRUSTED_PROXY_HOPS must be an integer between 1 and 16.");

  const encKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!encKey) {
    errors.push(
      "CREDENTIALS_ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32` (32 bytes = 64 hex chars).",
    );
  } else if (!HEX_64.test(encKey)) {
    errors.push(
      `CREDENTIALS_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes); got ${encKey.length} character(s). Generate one with \`openssl rand -hex 32\`.`,
    );
  }

  errors.push(...redisAuthErrors());

  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret || authSecret.trim() === "") {
    errors.push(
      "AUTH_SECRET is missing or empty. Generate one with `openssl rand -base64 32`.",
    );
  }

  if (errors.length > 0) {
    throw new Error(
      "Invalid environment configuration — fix the following before starting:\n" +
        errors.map((e) => `  - ${e}`).join("\n"),
    );
  }
}

/**
 * B4: in production Redis must require authentication. The queue and rate
 * limits share it, so an unauthenticated URL is refused at startup by both the
 * web process and the worker (which has no AUTH_SECRET and its own check).
 */
export function redisAuthErrors(env: Record<string, string | undefined> = process.env): string[] {
  if (env.NODE_ENV !== "production") return [];
  const raw = env.REDIS_URL;
  if (!raw) return ["REDIS_URL is required in production and must include the Redis password."];
  try {
    const url = new URL(raw);
    if (!/^rediss?:$/.test(url.protocol)) return ["REDIS_URL must use redis:// or rediss://."];
    if (!url.password) return ["REDIS_URL must include the Redis password (redis://:PASSWORD@host:6379); Redis must run with requirepass."];
  } catch { return ["REDIS_URL is not a valid URL."]; }
  return [];
}
export function assertWorkerEnv(env: Record<string, string | undefined> = process.env): void {
  const errors = redisAuthErrors(env);
  if (errors.length) throw new Error("Invalid worker environment:\n" + errors.map(e => `  - ${e}`).join("\n"));
}
