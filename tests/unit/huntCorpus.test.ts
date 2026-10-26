import { describe, expect, it } from "vitest";
import { analyzeCorpus, persistableCorpus, persistedCorpusSchema } from "@/server/hunt/corpus";
describe("structured Recon/Hunt corpus", () => {
  it("retains usable observations while excluding bodies, token values and credentials from durable metadata", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature";
    const corpus = analyzeCorpus({ urls: ["https://example.test/search?q=private-search-term", "https://foreign.test/api/1", "https://example.test/logout", "https://example.test/oauth/authorize?client_id=test&response_type=code&state=private-oauth-state", "https://example.test/api?access_token=secret-token"], authenticated: true,
      html: `<form action="/save" method="POST"><input name="csrf" value="private-csrf-secret"></form><script>fetch('/api/update', {method:'PATCH'}); const t='${jwt}';</script>`,
      pages: [{ url: "https://example.test", status: 200, body: "not stored", headers: { "content-type": "text/html", "set-cookie": "session=private-cookie-secret; Secure; HttpOnly; SameSite=None", server: "nginx", "x-powered-by": "Express" } }],
    }, "https://example.test");
    expect(corpus.surface).toMatchObject({ forms: true, javascript: true, jwt: true, oauth: true });
    expect(corpus.urls.some(u => u.includes("/oauth/authorize"))).toBe(false);
    expect(corpus.forms.some(f => f.method === "PATCH")).toBe(true);
    expect(corpus.urls.every(u => !u.includes("foreign.test") && !u.includes("logout") && !u.includes("secret-token"))).toBe(true);
    const saved = persistableCorpus(corpus);
    const serialized = JSON.stringify(saved);
    for (const secret of [jwt, "private-cookie-secret", "private-csrf-secret", "private-search-term", "secret-token", "not stored", "private-oauth-state"]) expect(serialized).not.toContain(secret);
    expect(saved.technologies).toEqual(["nginx", "express"]);
    expect(saved.cookies[0]).toMatchObject({ name: "session", secure: true, httpOnly: true, sameSite: "none" });
    expect(persistedCorpusSchema.safeParse(saved).success).toBe(true);
  });
  it("does not infer XML parsing capability from an endpoint name", () => {
    const corpus = analyzeCorpus({ html: "<p>not XML</p>", urls: ["https://example.test/soap.xml"], authenticated: false, pages: [{ url: "https://example.test/soap.xml", body: "<p>not XML</p>", headers: { "content-type": "text/html" }, status: 200 }] }, "https://example.test");
    expect(corpus.surface.xml).toBe(false);
    expect(corpus.objectUrls).toEqual([]);
  });
  it("only declares public XSS coverage after anonymous successful query observations", () => {
    const raw = { html: "Public query", urls: ["https://example.test/search?q=public"], authenticated: false, pages: [{ url: "https://example.test/search?q=public", status: 200, body: "public", headers: { "content-type": "text/html" } }] };
    expect(persistableCorpus(analyzeCorpus(raw, "https://example.test")).publicXssSurface).toBe(true);
    expect(analyzeCorpus({ ...raw, authenticated: true }, "https://example.test").publicXssSurface).toBe(false);
    expect(analyzeCorpus({ ...raw, pages: [...raw.pages, { ...raw.pages[0], url: "https://example.test/private?q=1", status: 401 }] }, "https://example.test").publicXssSurface).toBe(false);
    expect(analyzeCorpus({ ...raw, pages: [] }, "https://example.test").publicXssSurface).toBe(false);
  });

});
