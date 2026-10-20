import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptSecret, decryptSecret, secretsEqual } from "@/lib/crypto";

// A valid AES-256 key is 32 bytes = 64 hex chars. crypto.ts reads the key
// lazily from process.env on each call, so each test sets/unsets it explicitly.
const VALID_KEY = "a".repeat(64);
const ORIGINAL = process.env.CREDENTIALS_ENCRYPTION_KEY;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY;
  else process.env.CREDENTIALS_ENCRYPTION_KEY = ORIGINAL;
});

describe("encrypt/decrypt round-trip with a valid key", () => {
  beforeEach(() => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = VALID_KEY;
  });

  it("decrypts back to the original plaintext", () => {
    const plain = "sk-test-APIKEY-12345";
    const cipher = encryptSecret(plain);
    expect(cipher).not.toContain(plain);
    expect(decryptSecret(cipher)).toBe(plain);
  });

  it("produces a different ciphertext each call (random IV)", () => {
    const plain = "same-secret";
    const a = encryptSecret(plain);
    const b = encryptSecret(plain);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(plain);
    expect(decryptSecret(b)).toBe(plain);
  });

  it("round-trips the empty string and unicode", () => {
    expect(decryptSecret(encryptSecret(""))).toBe("");
    const u = "clé-secrète-🔐";
    expect(decryptSecret(encryptSecret(u))).toBe(u);
  });
});

describe("tamper detection (GCM auth tag)", () => {
  beforeEach(() => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = VALID_KEY;
  });

  it("throws when the ciphertext body is altered", () => {
    const cipher = encryptSecret("do-not-tamper");
    const [iv, tag, body] = cipher.split(":");
    // Flip the first base64 char of the ciphertext body to a different one.
    const flipped = (body[0] === "A" ? "B" : "A") + body.slice(1);
    const tampered = [iv, tag, flipped].join(":");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("throws on a malformed payload (wrong number of parts)", () => {
    expect(() => decryptSecret("only:twoparts")).toThrow(/Malformed/);
  });
});

describe("key loading errors", () => {
  it("throws a clear error when the key is absent", () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    expect(() => encryptSecret("x")).toThrow(/CREDENTIALS_ENCRYPTION_KEY is not set/);
  });

  it("throws when the key decodes to the wrong length", () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = "abcd"; // 2 bytes, not 32
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
  });

  it("throws when the key is non-hex", () => {
    // 64 non-hex chars: Buffer.from(..,'hex') yields 0 bytes -> length check fails.
    process.env.CREDENTIALS_ENCRYPTION_KEY = "z".repeat(64);
    expect(() => encryptSecret("x")).toThrow(/bytes/);
  });

  it("decrypt also fails clearly with a bad key", () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = VALID_KEY;
    const cipher = encryptSecret("secret");
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    expect(() => decryptSecret(cipher)).toThrow(/CREDENTIALS_ENCRYPTION_KEY is not set/);
  });
});

describe("secretsEqual (constant-time compare)", () => {
  it("is true for identical strings, false otherwise", () => {
    expect(secretsEqual("abc", "abc")).toBe(true);
    expect(secretsEqual("abc", "abd")).toBe(false);
    expect(secretsEqual("abc", "abcd")).toBe(false);
  });
});
