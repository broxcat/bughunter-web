import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the prisma singleton so no database is touched. Only oobHit.findFirst is
// used by this module; we return a row or null per test.
const prismaMock = vi.hoisted(() => ({
  oobHit: { findFirst: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { generateOobToken, checkOobHit } from "@/server/oob/index";

const ORIGINAL_BASE = process.env.OOB_PUBLIC_BASE_URL;

afterEach(() => {
  if (ORIGINAL_BASE === undefined) delete process.env.OOB_PUBLIC_BASE_URL;
  else process.env.OOB_PUBLIC_BASE_URL = ORIGINAL_BASE;
  vi.clearAllMocks();
});

describe("generateOobToken", () => {
  it("mints a 32-char url-safe hex token and a callbackUrl from OOB_PUBLIC_BASE_URL", () => {
    process.env.OOB_PUBLIC_BASE_URL = "http://100.64.0.1:8089";
    const { token, callbackUrl } = generateOobToken();

    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(callbackUrl).toBe(`http://100.64.0.1:8089/oob/${token}`);
  });

  it("strips a trailing slash on the configured base", () => {
    process.env.OOB_PUBLIC_BASE_URL = "http://host:8089/";
    const { token, callbackUrl } = generateOobToken();
    expect(callbackUrl).toBe(`http://host:8089/oob/${token}`);
  });

  it("falls back to the documented localhost base when the env var is unset", () => {
    delete process.env.OOB_PUBLIC_BASE_URL;
    const { token, callbackUrl } = generateOobToken();
    expect(callbackUrl).toBe(`http://127.0.0.1:8089/oob/${token}`);
  });

  it("returns a unique token each call", () => {
    const a = generateOobToken().token;
    const b = generateOobToken().token;
    expect(a).not.toBe(b);
  });
});

describe("checkOobHit", () => {
  beforeEach(() => {
    prismaMock.oobHit.findFirst.mockReset();
  });

  it("maps a found row to the {receivedAt, sourceIp, method} shape", async () => {
    const when = new Date("2026-10-20T10:00:00.000Z");
    prismaMock.oobHit.findFirst.mockResolvedValue({
      id: "x",
      token: "tok123",
      receivedAt: when,
      sourceIp: "203.0.113.9",
      method: "GET",
      rawHeaders: { host: "h" },
    });

    const result = await checkOobHit("tok123");

    expect(result).toEqual({
      receivedAt: when,
      sourceIp: "203.0.113.9",
      method: "GET",
    });
    // Correlates on the token, earliest hit first.
    expect(prismaMock.oobHit.findFirst).toHaveBeenCalledWith({
      where: { token: "tok123" },
      orderBy: { receivedAt: "asc" },
    });
  });

  it("returns null when the target never called back", async () => {
    prismaMock.oobHit.findFirst.mockResolvedValue(null);
    const result = await checkOobHit("never-seen");
    expect(result).toBeNull();
  });

  it("passes through a null sourceIp", async () => {
    prismaMock.oobHit.findFirst.mockResolvedValue({
      receivedAt: new Date(0),
      sourceIp: null,
      method: "POST",
    });
    const result = await checkOobHit("tok");
    expect(result).toEqual({ receivedAt: new Date(0), sourceIp: null, method: "POST" });
  });
});
