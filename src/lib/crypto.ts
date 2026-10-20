import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

// AES-256-GCM secret encryption for stored AI provider API keys.
//
// SECURITY INVARIANT: a plaintext API key must NEVER be returned to the browser
// or logged. `encryptSecret` is the only way a key enters the database
// (AiProviderConfig.apiKeyCipher); `decryptSecret` is called server-side only,
// at the moment a provider is invoked. Neither the ciphertext nor the key
// should be surfaced through any API response.

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32; // AES-256 => 32-byte key
const IV_BYTES = 12; // GCM standard nonce length
const TAG_BYTES = 16; // GCM authentication tag length

// Loaded lazily so that merely importing this module (e.g. during type-checking
// or in code paths that never touch secrets) doesn't throw when the env var is
// absent. The key is only required when we actually encrypt or decrypt.
function loadKey(): Buffer {
  const hex = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY is not set. Generate one with " +
        "`openssl rand -hex 32` (32 bytes = 64 hex chars).",
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(hex, "hex");
  } catch {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY must be valid hex.");
  }
  // Buffer.from silently ignores invalid/odd hex, so validate the decoded length.
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `CREDENTIALS_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes ` +
        `(${KEY_BYTES * 2} hex chars); got ${key.length} bytes.`,
    );
  }
  return key;
}

/**
 * Encrypt a secret with AES-256-GCM.
 *
 * Output format: a single compact string `iv:authTag:ciphertext`, each part
 * base64-encoded. A fresh random 12-byte IV is used per call, so encrypting the
 * same plaintext twice yields different ciphertexts.
 */
export function encryptSecret(plain: string): string {
  if (typeof plain !== "string") {
    throw new TypeError("encryptSecret expects a string.");
  }
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/**
 * Reverse `encryptSecret`. Verifies the GCM authentication tag, so any
 * tampering with the stored ciphertext throws rather than returning garbage.
 */
export function decryptSecret(payload: string): string {
  if (typeof payload !== "string") {
    throw new TypeError("decryptSecret expects a string.");
  }
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed ciphertext payload.");
  }
  const key = loadKey();
  const iv = Buffer.from(parts[0], "base64");
  const authTag = Buffer.from(parts[1], "base64");
  const ciphertext = Buffer.from(parts[2], "base64");
  if (iv.length !== IV_BYTES || authTag.length !== TAG_BYTES) {
    throw new Error("Malformed ciphertext payload.");
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(), // throws if the auth tag doesn't verify
  ]);
  return plain.toString("utf8");
}

/**
 * Constant-time comparison helper for callers that need to compare a decrypted
 * secret against a candidate without leaking timing. Exported for completeness;
 * most callers simply use the decrypted key directly.
 */
export function secretsEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
