import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
  createHmac,
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
function loadKey(hex = process.env.CREDENTIALS_ENCRYPTION_KEY): Buffer {
  if (!hex) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY is not set. Generate one with " +
        "`openssl rand -hex 32` (32 bytes = 64 hex chars).",
    );
  }
  if (hex.length !== KEY_BYTES * 2 || !/^[a-f0-9]+$/i.test(hex)) {
    throw new Error('Credential encryption key must decode to 32 bytes of valid hex.');
  }
  return Buffer.from(hex, 'hex');
}

function keyId(value: string) {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(value)) throw new Error('Invalid credential encryption key ID.');
  return value;
}

function currentKeyId() {
  return keyId(process.env.CREDENTIALS_ENCRYPTION_KEY_ID ?? 'primary');
}

function keyForId(id: string) {
  if (id === currentKeyId()) return loadKey();
  let keys: unknown;
  try { keys = JSON.parse(process.env.CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS ?? '{}'); }
  catch { throw new Error('Invalid previous credential encryption keys configuration.'); }
  if (!keys || typeof keys !== 'object' || Array.isArray(keys) || !Object.hasOwn(keys, id)) {
    throw new Error('Credential encryption key version is unavailable.');
  }
  const hex = (keys as Record<string, unknown>)[id];
  if (typeof hex !== 'string') throw new Error('Invalid previous credential encryption key.');
  return loadKey(hex);
}

/** Non-reversible, domain-separated identity for private runtime references.
 * Reuses the existing backend key; neither input nor key is persisted. */
export function privateReferenceFingerprint(domain: string, value: string): string {
  // Anonymous-only deployments need no credential encryption configuration;
  // their already-required authentication signing secret supplies the key.
  const key = process.env.CREDENTIALS_ENCRYPTION_KEY ? loadKey() : process.env.AUTH_SECRET;
  if (!key) throw new Error('Backend privacy key unavailable');
  return createHmac('sha256', key).update(domain + '\0' + value).digest('hex');
}

/**
 * Encrypt a secret with AES-256-GCM.
 *
 * Output format: `v1:keyId:iv:authTag:ciphertext`, with three base64 parts. A fresh random 12-byte IV is used per call, so encrypting the
 * same plaintext twice yields different ciphertexts.
 */
export function encryptSecret(plain: string): string {
  if (typeof plain !== "string") {
    throw new TypeError("encryptSecret expects a string.");
  }
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const envelope = 'v1:' + currentKeyId();
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(envelope));
  const ciphertext = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    envelope,
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
  const versioned = parts.length === 5 && parts[0] === 'v1';
  if (!versioned && parts.length !== 3) throw new Error('Malformed ciphertext payload.');
  const id = keyId(versioned ? parts[1] : process.env.CREDENTIALS_ENCRYPTION_LEGACY_KEY_ID ?? 'primary');
  const key = keyForId(id);
  const offset = versioned ? 2 : 0;
  const iv = Buffer.from(parts[offset], 'base64');
  const authTag = Buffer.from(parts[offset + 1], 'base64');
  const ciphertext = Buffer.from(parts[offset + 2], 'base64');
  if (iv.length !== IV_BYTES || authTag.length !== TAG_BYTES) {
    throw new Error("Malformed ciphertext payload.");
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  if (versioned) decipher.setAAD(Buffer.from('v1:' + id));
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
