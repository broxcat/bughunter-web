import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { createHuntPolicySnapshot } from "@/lib/hunt/policy";
import { withTargetExecution } from "@/server/execution";
import { withHuntSession, runFamilyTechniques } from "@/server/hunt/runtime";
import { HUNT_CAPABILITIES } from "@/lib/hunt/policy";
import { encryptSecret } from "@/lib/crypto";
import type { HuntReport } from "@/lib/hunt/report";

const fixture = vi.hoisted(() => ({ rows: [] as object[], credentials: [] as object[], reports: [] as HuntReport[], findings: [] as Record<string, unknown>[], logs: [] as string[], mode: "literal" }));
vi.mock("@/server/queue/logBus", () => ({ publishScanLog: vi.fn(async () => {}) }));
vi.mock("playwright-chromium", () => ({ chromium: { executablePath: () => "/missing-test-browser" } }));
vi.mock("@/server/credentials", () => ({ loadTargetCredentials: vi.fn(async () => fixture.credentials), credentialHeaders: (c: { cookies?: Record<string, string>; bearerToken?: string }) => ({ ...(c.cookies ? { Cookie: Object.entries(c.cookies).map(([k, v]) => `${k}=${v}`).join("; ") } : {}), ...(c.bearerToken ? { Authorization: `Bearer ${c.bearerToken}` } : {}) }) }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  target: { findUnique: vi.fn(async () => ({ id: "target", userId: "user", active: true, host: new URL(base).host, scope: { status: "APPROVED" }, program: { ownerId: "user", requiredUserAgent: "Hunt-Scoped-Required/1.0", outOfScope: [], qualifying: [], nonQualifying: [] } })) },
  targetCredential: { findMany: vi.fn(async () => fixture.rows) },
  scanRun: { findFirst: vi.fn(async () => null), updateMany: vi.fn(async (args: { data: { huntReport?: HuntReport } }) => { if (args.data.huntReport) fixture.reports.push(structuredClone(args.data.huntReport)); return { count: 1 }; }) },
  scanLog: { create: vi.fn(async (args: { data: { line: string } }) => { fixture.logs.push(args.data.line); }) },
  finding: { create: vi.fn(async (args: { data: Record<string, unknown> }) => { fixture.findings.push(args.data); return { id: `finding-${fixture.findings.length}` }; }) },
} }));
let server: Server;
let base: string;
const requests: { url: string; ua?: string; method?: string }[] = [];
const ua = "Hunt-Scoped-Required/1.0";
const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0IiwiaWQiOiJBIiwiaWF0IjoxfQ.signature";
beforeAll(async () => {
  process.env.CREDENTIALS_ENCRYPTION_KEY ??= "0".repeat(64);
  server = createServer((req, res) => {
    requests.push({ url: req.url ?? "/", ua: req.headers["user-agent"], method: req.method });
    const u = new URL(req.url ?? "/", base);
    if (u.pathname === "/objects/123") {
      res.setHeader("Content-Type", "application/json");
      const hasCredentials = Boolean(req.headers.cookie || req.headers.authorization);
      if (!hasCredentials) { res.writeHead(401); res.end('{"error":"unauthorized"}'); return; }
      if (fixture.mode === "bola-denied" && req.headers.cookie?.includes("secret-a")) { res.writeHead(403); res.end('{"error":"forbidden"}'); return; }
      res.end('{"id":123,"ownerId":"account-b","document":"private test fixture"}'); return;
    }
    if (u.pathname === "/search") {
      const q = u.searchParams.get("q") ?? "1";
      if (fixture.mode === "sql") {
        res.setHeader("Content-Type", "application/json");
        if (q.endsWith("'")) res.end('{"error":"SQL syntax error at or near quote"}');
        else if (q.includes("AND 1=2")) res.end("[]");
        else res.end('{"id":1,"name":"original test record"}'); return;
      }
      res.setHeader("Content-Type", "text/html");
      const text = fixture.mode === "evaluate" ? q.replace(/\{\{(\d+)\*(\d+)\}\}/g, (_, a, b) => String(Number(a) * Number(b))) : q;
      res.end(`<html><body><p>Query ${text}</p></body></html>`); return;
    }
    if (u.pathname === "/.git/HEAD") { res.end("not exposed"); return; }
    res.setHeader("Content-Type", "text/html");
    res.setHeader("Set-Cookie", "session=do-not-store-this-cookie; HttpOnly; SameSite=Lax");
    res.end('<html><title>Public catch-all</title><a href="/search?q=1">search</a><a href="/objects/123">object</a><a href="/transfer">sensitive action</a><form action="/purchase" method="POST"><input name="price" value="1"></form><script>const unusedSinkName="innerHTML";</script></html>');
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));
beforeEach(() => { fixture.rows = []; fixture.credentials = []; fixture.reports = []; fixture.findings = []; fixture.logs = []; fixture.mode = "literal"; requests.length = 0; });
async function hunt(qualifying: string[], nonQualifying: string[] = []) {
  const ctx = { scanRunId: `run-${Math.random()}`, targetId: "target", userId: "user", host: new URL(base).host, baseUrl: base };
  await withTargetExecution({ targetId: "target", host: ctx.host, requiredUserAgent: ua, qualifying, nonQualifying }, () => withHuntSession(ctx, createHuntPolicySnapshot({ qualifying, nonQualifying }), async readiness => {
    for (const family of readiness.families.filter(f => f.selected && f.safeSubset)) {
      const known = HUNT_CAPABILITIES.find(c => c.family === family.family);
      if (known) await runFamilyTechniques(ctx, known.family);
    }
  }));
  return fixture.reports.at(-1)!;
}
function addAccounts() {
  fixture.credentials = [{ id: "a", label: "Account A", purpose: "ACCOUNT_A", cookies: { session: "secret-a" } }, { id: "b", label: "Account B", purpose: "ACCOUNT_B", ownedObjectUrl: `${base}/objects/123`, cookies: { session: "secret-b" } }];
  fixture.rows = fixture.credentials.map((c: object) => { const v = c as { id: string; label: string; purpose: string; cookies: object; ownedObjectUrl?: string }; return { id: v.id, label: v.label, purpose: v.purpose, ownedObjectUrl: v.ownedObjectUrl, mode: "COOKIES", cookiesCipher: encryptSecret(JSON.stringify(v.cookies)), headerCipher: null, sessionRefreshedAt: null }; });
}
describe("bounded local Hunt runtime", () => {
  it("keeps literal SSTI reflection and a DOM sink at INFO signal/candidate, never a finding", async () => {
    const report = await hunt(["SSTI", "XSS"]);
    expect(fixture.findings).toHaveLength(0);
    expect(report.candidates.some(c => c.title === "Literal template reflection")).toBe(true);
    expect(report.candidates.some(c => c.title === "DOM source/sink observation" && c.evidenceLevel === "SIGNAL")).toBe(true);
    expect(new Set(requests.map(r => r.ua))).toEqual(new Set([ua]));
    expect(report.requests).toBeLessThanOrEqual(report.limits.maxTotalRequests);
    expect(JSON.stringify(report)).not.toContain("do-not-store-this-cookie");
  });
  it("confirms arithmetic only with two independent evaluated markers and an inert control", async () => {
    fixture.mode = "evaluate";
    const report = await hunt(["SSTI"]);
    expect(fixture.findings).toHaveLength(1);
    expect(fixture.findings[0]).toMatchObject({ confidence: "PROVEN", severity: "HIGH", gateStatus: "UNVALIDATED", huntMetadata: { techniqueId: "ssti.arithmetic-differential", evidenceLevel: "CONFIRMED" } });
    expect(report.candidates.find(c => c.evidenceLevel === "CONFIRMED")?.controls).toContain("INERT_CONTROL");
  });
  it("requires independent SQL error and repeated boolean controls before promotion", async () => {
    fixture.mode = "sql";
    const report = await hunt(["SQL_INJECTION"]);
    expect(fixture.findings).toHaveLength(1);
    expect(report.candidates.some(c => c.evidenceLevel === "VALIDATED")).toBe(true);
    expect(report.candidates.find(c => c.evidenceLevel === "CONFIRMED")?.controls).toContain("INDEPENDENT_DB_ERROR_TECHNIQUE");
    expect(requests.some(r => /sleep|waitfor|pg_sleep/i.test(r.url))).toBe(false);
  });
  it("blocks unconfigured IDOR/BOLA/JWT and unavailable XML/OAuth without stopping safe families", async () => {
    const report = await hunt(["IDOR", "JWT", "XXE", "OAUTH", "XSS"]);
    for (const family of ["bola", "jwt"]) expect(report.families.find(f => f.family === family)?.state).toBe("BLOCKED");
    expect(report.families.find(f => f.family === "idor")?.readiness).toBe("DEGRADED");
    expect(report.families.find(f => f.family === "xss")?.completedTechniques).toBeGreaterThan(0);
    expect(fixture.findings).toHaveLength(0);
  });
  it("compares only owner-attested test objects, independently confirms BOLA and never stores session values", async () => {
    addAccounts();
    const report = await hunt(["IDOR"]);
    expect(fixture.findings).toHaveLength(1);
    expect(report.candidates.find(c => c.evidenceLevel === "CONFIRMED")?.controls).toContain("INDEPENDENT_ANONYMOUS_CONTROL");
    expect(JSON.stringify([fixture.logs, fixture.findings, report])).not.toMatch(/secret-a|secret-b/);
    fixture.findings = []; fixture.mode = "bola-denied";
    await hunt(["IDOR"]);
    expect(fixture.findings).toHaveLength(0);
  });
  it("does not execute stateful actions or unsupported techniques, even when all families qualify", async () => {
    const report = await hunt([], ["SSRF", "XSS"]);
    expect(requests.every(r => r.method === "GET")).toBe(true);
    expect(requests.some(r => /\/transfer|\/purchase|169\.254|127\.0\.0\.1:1|etc\/passwd/i.test(r.url))).toBe(false);
    expect(report.techniques.filter(t => /race-replay|value-mutation|skip-final|submit-action|file-read|gadget-chain|paired-timing|internal-probing/.test(t.techniqueId)).every(t => t.state === "SKIPPED")).toBe(true);
    expect(report.families.find(f => f.family === "ssrf")?.selected).toBe(false);
  });
  it("JWT integrity confirmation retains no token and performs no signing-secret recovery", async () => {
    fixture.credentials = [{ id: "jwt", label: "JWT test", purpose: "JWT", bearerToken: token, ownedObjectUrl: `${base}/objects/123` }];
    fixture.rows = [{ id: "jwt", label: "JWT test", mode: "BEARER", purpose: "JWT", ownedObjectUrl: `${base}/objects/123`, headerCipher: encryptSecret(token), cookiesCipher: null }];
    const report = await hunt(["JWT"]);
    expect(fixture.findings).toHaveLength(1);
    expect(JSON.stringify([report, fixture.findings, fixture.logs])).not.toContain(token);
    expect(report.techniques.find(t => t.techniqueId === "jwt.secret-recovery")?.state).toBe("SKIPPED");
  });
});
