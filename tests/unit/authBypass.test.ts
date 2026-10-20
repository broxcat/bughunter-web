import { describe, it, expect } from "vitest";
import { classifyBypassResponse } from "@/server/scanners/auth-bypass";
import type { ProbeResult } from "@/server/scanners/http";

// Minimal ProbeResult builder for the classifier (pure, no network).
function resp(partial: Partial<ProbeResult> & { body: string }): ProbeResult {
  const headers = partial.headers ?? {};
  return {
    url: partial.url ?? "https://t.example/x",
    method: partial.method ?? "GET",
    status: partial.status ?? 200,
    ms: partial.ms ?? 1,
    bodyLen: partial.bodyLen ?? partial.body.length,
    body: partial.body,
    headers,
    error: partial.error,
  };
}

const HOMEPAGE =
  '<!doctype html><html><head><title>BugHunter</title></head><body><main>Welcome</main></body></html>';

describe("classifyBypassResponse", () => {
  // THE real-world false positive: X-Original-URL on /api/admin/users returned a
  // 200 whose body was just the site's HTML homepage (same as the catch-all for a
  // bogus path). Must stay CANDIDATE, never PROVEN.
  it("keeps CANDIDATE when the 200 is identical to the catch-all homepage", () => {
    const target = resp({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: HOMEPAGE });
    const catchAll = resp({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: HOMEPAGE });
    const v = classifyBypassResponse("/api/admin/users", target, catchAll);
    expect(v.confidence).toBe("CANDIDATE");
    expect(v.reason).toMatch(/catch-all|false positive/i);
  });

  it("keeps CANDIDATE when the 200 is the same default page by <title>/size (not byte-identical)", () => {
    const target = resp({ status: 200, headers: { "content-type": "text/html" }, body: HOMEPAGE + "<!-- req id 123 -->" });
    const catchAll = resp({ status: 200, headers: { "content-type": "text/html" }, body: HOMEPAGE + "<!-- req id 999 -->" });
    expect(classifyBypassResponse("/api/admin/users", target, catchAll).confidence).toBe("CANDIDATE");
  });

  it("marks PROVEN when the 200 is real JSON distinct from the catch-all page", () => {
    const target = resp({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ id: 1, email: "a@x.com", role: "admin" }, { id: 2, email: "b@x.com", role: "user" }]),
    });
    const catchAll = resp({ status: 200, headers: { "content-type": "text/html" }, body: HOMEPAGE });
    const v = classifyBypassResponse("/api/admin/users", target, catchAll);
    expect(v.confidence).toBe("PROVEN");
  });

  it("keeps CANDIDATE when the content-type is JSON but the body is an error shell", () => {
    const target = resp({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Not Found", code: 404 }),
    });
    const catchAll = resp({ status: 200, headers: { "content-type": "text/html" }, body: HOMEPAGE });
    expect(classifyBypassResponse("/api/admin/users", target, catchAll).confidence).toBe("CANDIDATE");
  });

  it("keeps CANDIDATE for a differing HTML response that can't be attributed to the resource", () => {
    const target = resp({ status: 200, headers: { "content-type": "text/html" }, body: "<html><body>some other page entirely</body></html>" });
    const catchAll = resp({ status: 404, headers: { "content-type": "text/html" }, body: "<html><body>404</body></html>" });
    expect(classifyBypassResponse("/admin", target, catchAll).confidence).toBe("CANDIDATE");
  });
});
