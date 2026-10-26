import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { executeHuntTechnique } from "@/server/hunt/techniques";
import { HUNT_TECHNIQUES } from "@/lib/hunt/catalogData";
import { analyzeCorpus } from "@/server/hunt/corpus";
import { HuntBudget, HUNT_LIMITS } from "@/server/hunt/budget";
import { withTargetExecution } from "@/server/execution";
import { probe } from "@/server/scanners/http";
import type { TechniqueContext } from "@/server/hunt/runtime";
import type { DecryptedTargetCredential } from "@/server/credentials";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/server/queue/logBus", () => ({ publishScanLog: vi.fn() }));
vi.mock("@/server/credentials", () => ({ credentialHeaders: (c: { cookies?: Record<string, string>; bearerToken?: string }) => ({ ...(c.cookies ? { Cookie: Object.entries(c.cookies).map(([k, v]) => `${k}=${v}`).join("; ") } : {}), ...(c.bearerToken ? { Authorization: `Bearer ${c.bearerToken}` } : {}) }) }));
const oob = vi.hoisted(() => ({ hits: new Set<string>(), counter: 0 }));
vi.mock("@/server/oob", () => ({
  generateOobToken: () => { const token = (++oob.counter).toString(16).padStart(32, "0"); return { token, callbackUrl: `${process.env.OOB_PUBLIC_BASE_URL}/oob/${token}` }; },
  checkOobHit: async (token: string) => oob.hits.has(token) ? { receivedAt: new Date(), method: "GET", sourceIp: "127.0.0.1" } : null,
}));
let server: Server, base: string, mode = "negative";
const seen: { url: string; ua?: string; cookie?: string; authorization?: string; at: number }[] = [];
const originalToken = `${Buffer.from('{"alg":"HS256","kid":"test-key"}').toString("base64url")}.${Buffer.from('{"sub":"test-user","exp":4102444800}').toString("base64url")}.validSignature`;
const privateObject = '{"id":321,"ownerId":"test-b","name":"private synthetic document"}';
beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ url: req.url ?? "/", ua: req.headers["user-agent"], cookie: req.headers.cookie, authorization: req.headers.authorization, at: Date.now() });
    const u = new URL(req.url ?? "/", base);
    if (u.pathname === "/fetch") {
      const callback = new URL(u.searchParams.get("url") ?? base);
      // Synthetic target's behavior, never an Internet request.
      if (mode === "oob" && callback.origin === base && callback.pathname.startsWith("/controller/oob/")) oob.hits.add(callback.pathname.split("/").at(-1)!);
      res.end("synthetic fetch handler response"); return;
    }
    if (u.pathname === "/slow") { setTimeout(() => res.end("late response"), 150); return; }
    if (u.pathname === "/redirect") { res.writeHead(302, { Location: "http://localhost:1/foreign" }); res.end(); return; }
    if (u.pathname === "/api/object" || req.headers["x-original-url"]) {
      res.setHeader("Content-Type", "application/json");
      const token = req.headers.authorization?.slice(7) ?? /(?:^|; )jwt=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
      const otherSession = req.headers.cookie?.includes("ambient=accepted");
      const account = req.headers.cookie?.includes("session=test-");
      let accepted = token === originalToken || Boolean(otherSession) || Boolean(account);
      if (mode === "jwt-unsigned" && token) { try { accepted = /^(none|None)$/.test(JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString()).alg) || token === originalToken; } catch { accepted = false; } }
      if (mode === "jwt-ignore" && token) accepted = true;
      if (mode === "bola-denied" && req.headers.cookie?.includes("test-a")) accepted = false;
      if (mode === "auth-catchall" && req.headers["x-original-url"] && !accepted) { res.end('{"id":"fallback","name":"public default JSON resource"}'); return; }
      if (mode === "auth-real" && req.headers["x-original-url"] === "/api/object") accepted = true;
      if (req.headers.origin) {
        if (mode === "cors-reflect") { res.setHeader("Access-Control-Allow-Origin", req.headers.origin); res.setHeader("Access-Control-Allow-Credentials", "true"); }
        if (mode === "cors-null" && req.headers.origin === "null") res.setHeader("Access-Control-Allow-Origin", "null");
        if (mode === "cors-wildcard") { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Credentials", "true"); }
      }
      if (["cors-null", "cors-reflect", "cors-wildcard"].includes(mode)) { res.end(accepted ? privateObject : '{"id":0,"name":"public synthetic resource"}'); return; }
      if (!accepted) { res.writeHead(401); res.end('{"error":"unauthorized"}'); return; }
      res.end(privateObject); return;
    }
    if (u.pathname === "/search") {
      const q = u.searchParams.get("q") ?? "", normalized = q.replaceAll("/**/", " ");
      if (mode.startsWith("sql")) {
        res.setHeader("Content-Type", "application/json");
        if (mode === "sql-static") { res.end('{"error":"SQL syntax error at or near quote"}'); return; }
        if (mode === "sql-blocked" && /AND/.test(normalized)) { res.writeHead(403); res.end('{"error":"blocked by filter"}'); return; }
        if (q.endsWith("'")) { res.end('{"error":"syntax error at or near quote"}'); return; }
        if (/AND (?:1=2|'1'='2)/.test(normalized)) { res.end("[]"); return; }
        res.end(privateObject); return;
      }
      res.setHeader("Content-Type", "text/html");
      const syntax = mode === "ssti-dollar" ? /\$\{(\d+)\*(\d+)\}/g : mode === "ssti-java" ? /#\{(\d+)\*(\d+)\}/g : mode === "ssti-node" ? /<%= (\d+)\*(\d+) %>/g : /\{\{(\d+)\*(\d+)\}\}/g;
      const text = mode.startsWith("ssti") && mode !== "ssti-literal" ? q.replace(syntax, (_, a, b) => String(mode === "ssti-constant" ? 49 : Number(a) * Number(b))) : q;
      res.end(`<html><title>Synthetic</title><p>${text}</p></html>`); return;
    }
    if (u.pathname === "/view") {
      res.setHeader("Content-Type", "text/plain");
      const value = u.searchParams.get("file") ?? "";
      if (mode === "path-double" && value.startsWith("%2e%2e%2f")) { res.writeHead(500); res.end("FileNotFound: synthetic nonexistent marker"); return; }
      if (mode === "path-static") { res.writeHead(500); res.end("FileNotFound: constant application error"); return; }
      res.end("synthetic view response without file content"); return;
    }
    res.end("synthetic public catch-all response");
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
beforeEach(() => { seen.length = 0; mode = "negative"; oob.hits.clear(); vi.unstubAllEnvs(); });
const ua = "BugHunter-Synthetic-Required/42";
function execution() { return { targetId: "synthetic", host: new URL(base).host, requiredUserAgent: ua, qualifying: [], nonQualifying: [] }; }
function context(path = "/search?q=1", credentials: DecryptedTargetCredential[] = []): TechniqueContext {
  return { ctx: { scanRunId: "synthetic", targetId: "synthetic", userId: "test", baseUrl: base, host: new URL(base).host }, corpus: analyzeCorpus({ html: "", urls: [base + path], authenticated: false }, base), cache: new Map(), credentials, approvedTechniques: [], remainingMs: () => 20000, request: (url, opts) => probe(url, { ...opts, headers: { ...opts?.headers, "uSeR-AgEnT": "incorrect-scanner-agent" } }) };
}
const descriptor = (id: string) => HUNT_TECHNIQUES.find(t => t.id === id)!;
const run = (id: string, c: TechniqueContext) => withTargetExecution(execution(), () => executeHuntTechnique(descriptor(id), c));
const jwtCredential = (): DecryptedTargetCredential => ({ id: "jwt-test", label: "Test JWT", purpose: "JWT", bearerToken: originalToken, ownedObjectUrl: base + "/api/object" });
describe("controlled local validation fixtures", () => {
  it.each(["sql-numeric", "sql-string"])("confirms independent SQL error and content predicates: %s", async variant => {
    mode = variant; const c = context(variant === "sql-string" ? "/search?q=original" : "/search?q=1");
    expect((await run("sqli.error-differential", c))[0].evidence?.dbms).toBe("postgresql");
    expect((await run("sqli.boolean-differential", c))[0].evidenceLevel).toBe("CONFIRMED");
    expect(new Set(seen.map(r => r.ua))).toEqual(new Set([ua]));
  });
  it.each(["negative", "sql-static", "sql-blocked"])("never confirms reflection/static errors/status-only filter changes: %s", async variant => {
    mode = variant; const c = context();
    await run("sqli.error-differential", c);
    expect((await run("sqli.boolean-differential", c)).some(o => o.evidenceLevel === "CONFIRMED")).toBe(false);
  });
  it("finds the applicable second input within eight requests", async () => {
    mode = "sql-numeric"; const c = context();
    c.corpus.queryInputs.unshift({ url: base + "/not-sql?q=0", key: "q", value: "0" });
    expect((await run("sqli.error-differential", c))[0].evidenceLevel).toBe("VALIDATED");
    expect(seen.length).toBeLessThanOrEqual(8);
  });
  it.each([["ssti-curly", []], ["ssti-dollar", []], ["ssti-java", ["tomcat"]], ["ssti-node", ["express"]]] as [string, string[]][])("confirms arithmetic using applicable syntax and repeat: %s", async (variant, technologies) => {
    mode = variant; const c = context(); c.corpus.technologies = technologies;
    const result = await run("ssti.arithmetic-differential", c);
    expect(result[0].evidenceLevel).toBe("CONFIRMED");
    expect(result[0].controls).toContain("BASELINE_CONTROL");
    expect(seen.length).toBeLessThanOrEqual(8);
  });
  it.each(["ssti-literal", "ssti-constant", "negative"])("rejects literal/constant arithmetic responses: %s", async variant => {
    mode = variant; expect((await run("ssti.arithmetic-differential", context())).some(o => o.evidenceLevel === "CONFIRMED")).toBe(false);
  });
  it("treats encoded missing-path errors as candidates and static errors as negative", async () => {
    mode = "path-double";
    const result = await run("lfi.path-error-differential", context("/view?file=original.txt"));
    expect(result[0]).toMatchObject({ evidenceLevel: "CANDIDATE", evidence: { variant: "path.double" } });
    expect(seen.some(r => r.url.includes("%252e%252e%252f"))).toBe(true);
    expect(seen.every(r => !/passwd|win.ini|secret|metadata/.test(r.url))).toBe(true);
    mode = "path-static"; expect(await run("lfi.path-error-differential", context("/view?file=original.txt"))).toEqual([]);
  });
  it("reports null origin and reflected origins without claiming browser access", async () => {
    mode = "cors-null"; const c = context("/api/object");
    expect((await run("cors.origin-matrix", c))[0].evidence?.allowedOrigin).toBe("null");
    mode = "cors-reflect";
    expect((await run("cors.origin-matrix", c)).every(o => o.evidenceLevel === "CANDIDATE")).toBe(true);
    expect(seen.every(r => r.ua === ua)).toBe(true);
  });
  it("deduplicates invalid credentialed wildcard and never confirms it", async () => {
    mode = "cors-wildcard";
    const result = await run("cors.origin-matrix", context("/api/object"));
    expect(result).toHaveLength(1); expect(result[0].evidenceLevel).toBe("FALSE_POSITIVE");
  });
  it("rejects JWT none with signature validation but confirms an unsigned-only synthetic verifier", async () => {
    const c = context("/api/object", [jwtCredential()]);
    expect(await run("jwt.algorithm-differential", c)).toEqual([]);
    mode = "jwt-unsigned";
    expect((await run("jwt.algorithm-differential", c))[0].evidenceLevel).toBe("CONFIRMED");
    expect(seen.every(r => r.ua === ua)).toBe(true);
  });
  it("does not let an unrelated ambient session hide JWT signature rejection", async () => {
    const c = context("/api/object", [{ ...jwtCredential(), cookies: { ambient: "accepted" } }]);
    expect(await run("jwt.validation-differential", c)).toEqual([]);
    expect(seen.every(r => !r.cookie)).toBe(true);
  });
  it("uses JWT cookies even if an unrelated opaque bearer is configured", async () => {
    mode = "jwt-ignore";
    const c = context("/api/object", [{ ...jwtCredential(), bearerToken: "opaque-test-token", cookies: { jwt: originalToken } }]);
    expect((await run("jwt.validation-differential", c))[0].evidenceLevel).toBe("CONFIRMED");
    expect(seen.every(r => !r.authorization)).toBe(true);
  });
  it("keeps missing kid acceptance a candidate, never sends a path or remote key", async () => {
    mode = "jwt-ignore"; const c = context("/api/object", [jwtCredential()]);
    expect((await run("jwt.key-selection-review", c))[0].evidenceLevel).toBe("CANDIDATE");
    const header = JSON.parse(Buffer.from(seen.at(-1)!.authorization!.slice(7).split(".")[0], "base64url").toString());
    expect(header.kid).toMatch(/^bh-missing-[a-f0-9-]+$/); expect(header.jku).toBeUndefined();
  });
  it("rejects routing-header catch-all using an identical header control", async () => {
    mode = "auth-catchall"; const c = context("/api/object", [jwtCredential()]);
    const result = await run("auth.routing-control", c);
    expect(result[0].evidenceLevel).toBe("FALSE_POSITIVE");
  });
  it("confirms a real routing-header bypass only when its object matches authenticated content", async () => {
    mode = "auth-real";
    expect((await run("auth.routing-control", context("/api/object", [jwtCredential()])))[0].evidenceLevel).toBe("CONFIRMED");
  });
  it("requires owner JSON and two account/anonymous controls", async () => {
    const credentials: DecryptedTargetCredential[] = [{ id: "a", label: "Test A", purpose: "ACCOUNT_A", cookies: { session: "test-a" } }, { id: "b", label: "Test B", purpose: "ACCOUNT_B", cookies: { session: "test-b" }, ownedObjectUrl: base + "/api/object" }];
    const c = context("/api/object", credentials);
    await run("bola.account-differential", c);
    expect((await run("bola.anonymous-control", c))[0].evidenceLevel).toBe("CONFIRMED");
    mode = "bola-denied"; const denied = context("/api/object", credentials);
    expect(await run("bola.account-differential", denied)).toEqual([]);
  });
  it("correlates two independent operator-owned OOB markers and never probes internal services", async () => {
    vi.stubEnv("OOB_PUBLIC_BASE_URL", base + "/controller"); mode = "oob";
    const c = context("/fetch?url=https%3A%2F%2Fexample.invalid");
    const result = await run("ssrf.controlled-oob", c);
    expect(result[0].evidenceLevel).toBe("VALIDATED");
    expect(oob.hits.size).toBe(2);
    expect(seen.every(r => r.ua === ua && r.url.startsWith("/fetch?"))).toBe(true);
    expect(seen.every(r => !/169\.254|metadata|%3A%3A1|passwd/.test(r.url))).toBe(true);
    mode = "negative"; oob.hits.clear(); c.remainingMs = () => 1;
    expect((await run("ssrf.controlled-oob", c))[0].evidenceLevel).toBe("CANDIDATE");
  });
  it.each([
    ["csrf.form-inventory", '<form action="/transfer" method="GET"><input name="amount"></form>', "/", "State-changing form"],
    ["csrf.api-inventory", '<script>fetch("/data",{method:"POST",headers:{"Content-Type":"application/json"}})</script>', "/", "Script API action"],
    ["xxe.document-review", '<xml xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="synthetic"/></xml>', "/", "XML parser"],
    ["serialization.input-signature", '<input value="BAhbAA==">', "/", "Serialized input"],
    ["business.critical-field-inventory", '<form action="/cart" method="POST"><input name="discount"><input name="qty"></form>', "/", "Critical business"],
    ["business.race-inventory", '<form action="/refund" method="POST"></form>', "/", "Limited-use action"],
    ["business.transition-review", '<form action="/complete" method="POST"></form>', "/", "Workflow transition"],
    ["idor.query-reference", "", "/query?filter%5Bowner_id%5D=opaque", "object-reference query"],
    ["oauth.flow-controls", "", "/oauth/authorize?client_id=private-client&redirect_uri=https%3A%2F%2Fexample.invalid%2Fcallback&response_type=code&state=private-state", "OAuth response"],
  ])("%s remains passive for relevant input, negative fixtures and misleading signatures", async (id, html, path, title) => {
    const c = context(path); c.corpus = analyzeCorpus({ html, urls: [base + path], authenticated: false }, base);
    const positive = await run(id, c);
    expect(positive.some(o => o.title.includes(title))).toBe(true);
    expect(positive.every(o => o.evidenceLevel === "SIGNAL")).toBe(true);
    expect(JSON.stringify(positive.map(o => ({ summary: o.summary, evidence: o.evidence })))).not.toContain("private-state");
    const negative = context("/"); expect(await run(id, negative)).toEqual([]);
    // A source signature or field name is intentionally insufficient for promotion.
    expect(seen).toHaveLength(0);
  });
});

describe("shared transport applies to every active family", () => {
  for (const id of ["sqli.error-differential", "ssti.arithmetic-differential", "cors.origin-matrix", "lfi.path-error-differential", "jwt.validation-differential", "bola.account-differential", "auth.routing-control", "xss.reflection"]) {
    it(`${id}: scope, timeout, cancellation, rate and header capture`, async () => {
      const budget = new HuntBudget(); budget.beginFamily(descriptor(id).family); budget.beginTechnique(id, 8);
      const c = context();
      try {
        await withTargetExecution(execution(), () => budget.run(async () => {
          const before = seen.length;
          expect((await c.request(base.replace("127.0.0.1", "localhost"))).status).toBe(0);
          expect(seen).toHaveLength(before);
          await c.request(base + "/probe"); await c.request(base + "/probe");
          expect(seen.at(-1)!.at - seen.at(-2)!.at).toBeGreaterThanOrEqual(HUNT_LIMITS.minRequestIntervalMs - 15);
          expect(seen.slice(before).every(r => r.ua === ua)).toBe(true);
          expect((await probe(base + "/slow", { timeoutMs: 25 })).status).toBe(0);
          const count = seen.length; budget.controller.abort();
          expect((await c.request(base + "/probe")).status).toBe(0);
          expect(seen).toHaveLength(count);
        }));
      } finally { budget.close(); }
    });
  }
  it("enforces a bounded unique-value budget per input and stops before dispatch", async () => {
    const budget = new HuntBudget(); budget.beginFamily("sqli");
    try {
      for (let i = 0; i < HUNT_LIMITS.maxPayloadsPerParameter; i++) {
        budget.beginTechnique(`variant-${i}`, 1); budget.acquire(base + `/search?q=${i}`, "GET")();
      }
      budget.beginTechnique("overflow", 1);
      expect(() => budget.acquire(base + "/search?q=one-too-many", "GET")).toThrow("PARAMETER_PROBE_LIMIT");
    } finally { budget.close(); }
  });
});
