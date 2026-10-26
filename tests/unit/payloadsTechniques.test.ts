import { describe, expect, it, vi, afterEach } from "vitest";
import { PAYLOAD_VARIANTS, payloadVariant, queryProbeUrl, sstiVariants, corsOrigins, PATT_COMMIT } from "@/lib/hunt/payloads";
import { serializationFormat, objectReference, databaseSignature, oauthControls } from "@/server/hunt/fingerprints";
import { HUNT_TECHNIQUES } from "@/lib/hunt/catalogData";
import { selectHuntTechniques } from "@/lib/hunt/catalog";
import { resolveHuntReadiness, EMPTY_READINESS_FACTS } from "@/lib/hunt/readiness";
import { analyzeCorpus } from "@/server/hunt/corpus";
import { executeHuntTechnique } from "@/server/hunt/techniques";
import { operatorOobBase } from "@/server/hunt/oobPolicy";
import type { TechniqueContext } from "@/server/hunt/runtime";
import { deniedObjectControl, hasObjectMarker } from "@/server/hunt/evidence";
import type { ProbeResult } from "@/server/scanners/http";

afterEach(() => vi.unstubAllEnvs());
describe("bounded technique payload registry", () => {
  it("deduplicates deterministic attributed variants with risk and proof contracts", () => {
    expect(new Set(PAYLOAD_VARIANTS.map(v => v.id)).size).toBe(PAYLOAD_VARIANTS.length);
    expect(PATT_COMMIT).toMatch(/^[a-f0-9]{40}$/);
    for (const v of PAYLOAD_VARIANTS) {
      const value = v.family === "jwt" ? "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature" : v.family === "cors" ? "https://api.example.test" : "1";
      expect(v.build(value, "marker")).toBe(v.build(value, "marker"));
      expect(v.prerequisites.length).toBeGreaterThan(0); expect(v.confirmation).toBeTruthy();
      expect(v.sourceSection).toContain("README.md#");
      expect(v.build(value, "marker")).not.toMatch(/etc\/passwd|win.ini|169\.254|curl |wget |rm /);
    }
  });
  it.each(["path.double", "path.mixed", "path.unicode", "path.mangled", "path.java"])("preserves the intended transport layer for %s", id => {
    const value = payloadVariant(id).build("", "synthetic");
    const url = queryProbeUrl("https://example.test/view?file=original&keep=unchanged", "file", value);
    expect(new URL(url).searchParams.get("file")).toBe(value);
    expect(new URL(url).searchParams.get("keep")).toBe("unchanged");
    if (id === "path.double") expect(url).toContain("%252e%252e%252f");
  });
  it("selects small technology-relevant syntax sets and never broadens SQL predicates", () => {
    expect(sstiVariants(["tomcat"])).toEqual(["ssti.dollar", "ssti.hash"]);
    expect(sstiVariants(["express"])).toEqual(["ssti.ejs", "ssti.curly"]);
    expect(sstiVariants(["django"])).toEqual(["ssti.curly", "ssti.dollar"]);
    for (const id of ["sql.numeric", "sql.string", "sql.comment"]) {
      const v = payloadVariant(id); expect(v.build("original", "", true)).not.toMatch(/\bOR\b|UNION|;|DROP|UPDATE/i);
    }
    expect(payloadVariant("cmd.delay").build("file", "999")).toBe("file;sleep 0");
    expect(corsOrigins("https://api.example.test")).toHaveLength(8);
  });
});
describe("passive format and reference classification", () => {
  it("rejects error transport and malformed/nested JSON as object ownership proof", () => {
    const r: ProbeResult = { url: "https://example.test/object", method: "GET", ms: 1, status: 200, body: '{"id":1,"ownerId":"owner","name":"synthetic private object"}', bodyLen: 60, headers: { "content-type": "application/json" } };
    expect(hasObjectMarker(r)).toBe(true);
    expect(hasObjectMarker({ ...r, body: 'malformed {"id":1' })).toBe(false);
    expect(hasObjectMarker({ ...r, body: '{"error":{"id":1}}' })).toBe(false);
    expect(deniedObjectControl(r, { ...r, status: 0, error: "timeout", body: "" })).toBe(false);
    expect(deniedObjectControl(r, { ...r, status: 302, body: "login" })).toBe(false);
    expect(deniedObjectControl(r, { ...r, status: 403, body: "denied" })).toBe(true);
  });
  it.each([
    ["aced00057372000141", "Java serialization"], ["04085b00", "Ruby Marshal"],
    ["800495002e", "Python pickle"], ["ff010f01", ".NET ViewState"],
    ["0001000000ffffffff0100000000", ".NET BinaryFormatter"],
  ])("recognizes structural binary magic %s without deserializing", (hex, format) => {
    expect(serializationFormat(Buffer.from(hex, "hex").toString("base64"))).toBe(format);
  });
  it.each(["rO0AB-not-a-java-object", "gAS-not-pickle", "/wE", "O:abc", "JSON", "eyJhbGciOiJub25lIn0", "x".repeat(9000)])("rejects prefix-only or unrelated values: %.30s", value => {
    expect(serializationFormat(value)).toBeNull();
  });
  it("recognizes encoded PHP and never reports values as evidence", () => {
    const value = 'O:4:"Test":0:{}';
    expect(serializationFormat(encodeURIComponent(value))).toBe("PHP serialization");
    expect(serializationFormat(Buffer.from(value).toString("base64"))).toBe("PHP serialization (base64)");
  });
  it.each(["/objects/123", "/objects/550e8400-e29b-41d4-a716-446655440000", "/objects/0123456789abcdef0123456789abcdef", "/query?filter%5Bowner_id%5D=opaque", "/query?object.id=YWJjZA%3D%3D"])("discovers numeric, opaque and nested references: %s", path => {
    expect(objectReference(`https://example.test${path}`)).toBe(true);
  });
  it("does not treat a bare route or arbitrary field as an object reference", () => {
    expect(objectReference("https://example.test/search?q=random")).toBe(false);
  });
  it("reuses the existing static/cache-buster filter before selecting injection inputs", () => {
    const base = "https://example.test";
    const corpus = analyzeCorpus({ html: "", urls: [base + "/_next/image?url=asset", base + "/favicon.ico?hash=cache", base + "/search?abcdef1234567890=&q=real-input"], authenticated: false }, base);
    expect(corpus.queryInputs.map(p => p.key)).toEqual(["q"]);
  });
  it.each([["ORA-00933 SQL command", "oracle"], ["syntax error at or near quote", "postgresql"], ["You have an error in your SQL syntax", "mysql"], ["unclosed quotation mark", "mssql"], ["sqlite syntax error", "sqlite"]])("fingerprints specific DBMS errors: %s", (body, dbms) => {
    expect(databaseSignature(body)).toBe(dbms);
  });
  it("reports OAuth controls without leaking state, client IDs or redirect values", () => {
    const summary = oauthControls("https://example.test/oauth/authorize?client_id=private-client&state=private-state&code_challenge_method=S256&redirect_uri=https://secret.example/callback");
    expect(summary).toContain("PKCE S256"); expect(summary).not.toMatch(/private-state|private-client|secret.example/);
  });
});
describe("catalogue policy and forbidden-risk enforcement", () => {
  const corpus = analyzeCorpus({ html: "", urls: ["https://example.test/search?q=1"], authenticated: false }, "https://example.test");
  it.each([...new Set(HUNT_TECHNIQUES.map(t => t.family))])("never selects denied family %s", family => {
    const t = HUNT_TECHNIQUES.find(t => t.family === family)!;
    const readiness = resolveHuntReadiness({ qualifying: ["XSS"], nonQualifying: [] }, EMPTY_READINESS_FACTS).map(f => f.family === family ? { ...f, selected: false } : f);
    expect(selectHuntTechniques(readiness, corpus.surface, EMPTY_READINESS_FACTS, [t])[0].executable).toBe(false);
  });
  it("refuses forbidden probes even if a descriptor is marked implemented and approved", async () => {
    const t = { ...HUNT_TECHNIQUES.find(t => t.id === "xxe.file-read")!, implementation: "IMPLEMENTED" as const, requiresApproval: false };
    const request = vi.fn();
    await expect(executeHuntTechnique(t, { corpus, approvedTechniques: [t.id], request } as unknown as TechniqueContext)).rejects.toThrow("UNSUPPORTED_TECHNIQUE");
    expect(request).not.toHaveBeenCalled();
  });
  it.each(["http://169.254.169.254", "http://2852039166", "http://0xa9fea9fe", "http://[fe90::1]", "http://[::ffff:169.254.169.254]", "http://metadata.google.internal", "http://100.100.100.200", "file:///tmp/callback", "http://user:pass@example.test", "http://example.test/?token=x"])("rejects unsafe OOB destination %s", base => {
    vi.stubEnv("OOB_PUBLIC_BASE_URL", base); expect(operatorOobBase()).toBeNull();
  });
  it("permits explicitly configured local synthetic OOB, but has no implicit loopback fallback", () => {
    vi.stubEnv("OOB_PUBLIC_BASE_URL", ""); expect(operatorOobBase()).toBeNull();
    vi.stubEnv("OOB_PUBLIC_BASE_URL", "http://127.0.0.1:8089/controller"); expect(operatorOobBase()?.pathname).toBe("/controller");
  });
});
