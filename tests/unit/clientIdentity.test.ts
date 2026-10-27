import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeIp, resolveClientIp } from "@/lib/clientIdentity";
const request = (xff?: string, real?: string) => ({ headers: new Headers({ ...(xff ? { "x-forwarded-for": xff } : {}), ...(real ? { "x-real-ip": real } : {}) }) });
afterEach(() => vi.unstubAllEnvs());
describe("validated client identity", () => {
  it.each([undefined, "false", "TRUE", "1"])("ignores all declarative headers with trust=%s", trust => {
    vi.stubEnv("TRUST_PROXY_HEADERS", trust);
    vi.stubEnv("AUTH_URL", "https://configured.example.test");
    for (const spoof of ["203.0.113.1", "203.0.113.2", "::1", "garbage"]) {
      expect(resolveClientIp(request(spoof, spoof))).toEqual({ ip: "unknown", source: "unknown" });
    }
  });
  it("can use a real socket address supplied by a server runtime", () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "false");
    expect(resolveClientIp(request("203.0.113.1"), "::ffff:192.0.2.5")).toEqual({ ip: "192.0.2.5", source: "direct" });
    expect(resolveClientIp(request(), "invalid").source).toBe("unknown");
  });
  it("selects from the right regardless of valid client-controlled prefixes", () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "true"); vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    for (const prefix of ["203.0.113.1", "203.0.113.2, 2001:db8::3"]) {
      expect(resolveClientIp(request(`${prefix}, 192.0.2.5`))).toEqual({ ip: "192.0.2.5", source: "trusted-proxy" });
    }
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    expect(resolveClientIp(request("203.0.113.1, 192.0.2.5, 10.0.0.1")).ip).toBe("192.0.2.5");
  });
  it.each(["0", "-1", "1.5", "17", "", "foo"])("fails safely for invalid hop count %s", hops => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "true"); vi.stubEnv("TRUSTED_PROXY_HOPS", hops);
    expect(resolveClientIp(request("192.0.2.5")).source).toBe("unknown");
  });
  it.each(["garbage, 192.0.2.5", "192.0.2.5,", ",192.0.2.5", "192.0.2.5:80", "[::1]", "fe80::1%eth0", "x".repeat(2050)])("rejects invalid chains %s", xff => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "true"); vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    expect(resolveClientIp(request(xff, "192.0.2.5")).source).toBe("unknown");
  });
  it("does not substitute x-real-ip or accept too short a chain", () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "true"); vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    expect(resolveClientIp(request("192.0.2.5", "203.0.113.1")).source).toBe("unknown");
    expect(resolveClientIp(request(undefined, "203.0.113.1")).source).toBe("unknown");
  });
  it.each([
    ["192.0.2.5", "192.0.2.5"], [" ::ffff:192.0.2.5 ", "192.0.2.5"],
    ["0:0:0:0:0:FFFF:c000:205", "192.0.2.5"],
    ["2001:0DB8:0:0:0:0:0:0001", "2001:db8::1"],
    ["2001:db8::1", "2001:db8::1"], ["127.000.0.1", null], ["unknown", null],
  ])("normalizes equivalent addresses: %s", (ip, expected) => expect(normalizeIp(ip)).toBe(expected));
});
