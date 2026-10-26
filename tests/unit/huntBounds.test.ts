import { describe, expect, it } from "vitest";
import { HuntBudget, HUNT_LIMITS } from "@/server/hunt/budget";
import { assessPairedTiming } from "@/server/hunt/evidence";
import { isSafeReadUrl, safeObservationUrl } from "@/lib/hunt/safety";
describe("Hunt HTTP bounds and evidence controls", () => {
  it("enforces request, family, technique and concurrency limits before dispatch", () => {
    const b = new HuntBudget();
    try {
      b.beginFamily("test"); b.beginTechnique("test", 2);
      const release = b.acquire("https://example.test/search", "GET");
      expect(() => b.acquire("https://example.test/search", "GET")).toThrow("CONCURRENCY_LIMIT"); release();
      b.acquire("https://example.test/search", "GET")();
      expect(() => b.acquire("https://example.test/search", "GET")).toThrow("TECHNIQUE_REQUEST_LIMIT");
      b.beginTechnique("other", 8); b.family!.requests = HUNT_LIMITS.maxRequestsPerFamily;
      expect(() => b.acquire("https://example.test/search", "GET")).toThrow("FAMILY_REQUEST_LIMIT");
      b.family!.requests = 0; b.requests = HUNT_LIMITS.maxTotalRequests;
      expect(() => b.acquire("https://example.test/search", "GET")).toThrow("TOTAL_REQUEST_LIMIT");
    } finally { b.close(); }
  });
  it("blocks mutating methods and GET actions, and enforces the global deadline", () => {
    const b = new HuntBudget();
    try {
      expect(() => b.acquire("https://example.test/object", "POST")).toThrow("STATE_CHANGING");
      for (const path of ["/transfer", "/purchase", "/users/delete", "/checkout/confirm", "/api?action=delete"]) expect(isSafeReadUrl(`https://example.test${path}`)).toBe(false);
      b.startedAt -= HUNT_LIMITS.globalTimeoutMs + 1;
      expect(() => b.acquire("https://example.test/search", "GET")).toThrow("HUNT_TIMEOUT");
    } finally { b.close(); }
  });
  it("rejects jitter and single-sample SQLi/CMDI timing signals", () => {
    expect(assessPairedTiming([20], [5020], [20], [7020])).toBe(false);
    expect(assessPairedTiming([20, 1000, 4000], [3000, 1100, 4500], [1000, 2000, 3000], [6000, 2100, 3100])).toBe(false);
    expect(assessPairedTiming([100, 110, 105], [3100, 3110, 3105], [110, 105, 100], [5110, 5105, 5100])).toBe(true);
    expect(assessPairedTiming([100, 110, 105], [3100, 3110, 3105], [110, 105, 100], [3110, 3105, 3100])).toBe(false);
  });
  it("does not put query payloads, tokens or URL credentials into observations", () => {
    const u = safeObservationUrl("https://user:password@example.test/search?token=secret&q=payload");
    expect(u).not.toContain("password"); expect(u).not.toContain("secret"); expect(u).not.toContain("payload");
  });
});
