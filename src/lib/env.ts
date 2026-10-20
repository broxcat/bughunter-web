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
