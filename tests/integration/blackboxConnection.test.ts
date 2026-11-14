import { allowFixture } from '../helpers/egressLab';
import { afterEach, afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { TargetCredential } from "@prisma/client";
import { encryptSecret } from "@/lib/crypto";
import { testStoredConnection } from "@/server/credentials/connection";
import { loadTargetCredentials } from "@/server/credentials";
import { ConnectionGuard } from "@/server/credentials/guard";
import { POST } from "@/app/api/targets/[id]/credentials/test/route";
const state = vi.hoisted(() => ({ rows: new Map<string, TargetCredential>(), host: "", active: true, excluded: false, authorized: true, serial: 0 }));
const target = () => ({ id: "target", host: state.host, scheme: "http", active: state.active, userId: "test-user", scope: { status: "APPROVED" }, program: { ownerId: "test-user", requiredUserAgent: "BlackBox-Required/1", outOfScope: state.excluded ? [state.host] : [], qualifying: [], nonQualifying: [] } });
vi.mock("@/lib/auth", () => ({ auth: async () => state.authorized ? { user: { id: "test-user" } } : null }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  target: { findUnique: async () => target(), findUniqueOrThrow: async () => target(), findFirst: async () => target() },
  targetCredential: {
    findFirst: async ({ where }: { where: { id: string; targetId: string } }) => { const row = state.rows.get(where.id); return row?.targetId === where.targetId ? row : null; },
    findMany: async ({ where }: { where: { targetId: string } }) => [...state.rows.values()].filter(row => row.targetId === where.targetId),
    create: async ({ data }: { data: Partial<TargetCredential> }) => { const row = makeRow(data); state.rows.set(row.id, row); return row; },
    update: async ({ where, data }: { where: { id: string }; data: Partial<TargetCredential> }) => { const row = { ...state.rows.get(where.id)!, ...data }; state.rows.set(row.id, row); return row; },
    updateMany: async ({ where, data }: { where: { id: string; sessionCheckId: string | null }; data: Partial<TargetCredential> }) => {
      const row = state.rows.get(where.id); if (!row || row.sessionCheckId !== where.sessionCheckId) return { count: 0 };
      state.rows.set(row.id, { ...row, ...data }); return { count: 1 };
    },
  },
} }));
let server: Server, base: string, behavior = "normal";
const seen: { path: string; ua?: string; at: number; method?: string; csrf?: string | string[] }[] = [];
const password = "local-fixture-password";
function makeRow(data: Partial<TargetCredential> = {}): TargetCredential {
  return { id: `credential-${++state.serial}`, targetId: `target-${state.serial}`, label: "Fixture account", mode: "COOKIES", purpose: "ACCOUNT_A", persona:null,reconEnabled:false,ownedObjectUrl: null, cookiesCipher: encryptSecret(JSON.stringify({ session: "fixture-a" })), headerCipher: null, emailCipher: null, passwordCipher: null, loginUrl: null, sessionCookiesCipher: null, sessionRefreshedAt: null, createdAt: new Date(), sessionStatus: "UNKNOWN", sessionCheckedAt: null, sessionExpiresAt: null, validationUrl: null, sessionIdentityHash: null, sessionCheckId: null, ...data };
}
function store(data: Partial<TargetCredential> = {}) { const row = makeRow(data); state.rows.set(row.id, row); return row; }
beforeAll(async () => {
  process.env.CREDENTIALS_ENCRYPTION_KEY ??= "0".repeat(64);
  server = createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", base);
    seen.push({ path: u.pathname, ua: req.headers["user-agent"], at: Date.now(), method: req.method, csrf: req.headers["x-csrf-token"] });
    const valid = /(?:^|;\s*)session=fixture-a(?:;|$)/.test(req.headers.cookie ?? "") && behavior !== "expired";
    if (behavior === "slow") { setTimeout(() => res.end("delayed synthetic response"), 250); return; }
    if (behavior === "catchall") { res.setHeader("Content-Type", "application/json"); res.end('{"id":"public","username":"public response"}'); return; }
    if (u.pathname === "/sign-in" || u.pathname === "/session") {
      const html = `<html><meta name="csrf-token" content="fixture-csrf"><form method="POST" action="/session"><input name="username"><input type="password" name="password"><input type="hidden" name="csrf" value="fixture-csrf">${behavior === "purchase" ? '<input name="amount" value="10">' : ""}<button type="submit">${behavior === "registration" ? "Create account" : "Sign in"}</button></form></html>`;
      res.setHeader("Content-Type", "text/html"); res.setHeader("X-CSRF-Token", "fixture-csrf");
      if (req.method === "POST") {
        let raw = ""; for await (const chunk of req) raw += chunk;
        const body = new URLSearchParams(raw);
        if (body.get("username") === "tester" && body.get("password") === password && body.get("csrf") === "fixture-csrf" && req.headers.cookie?.includes("csrf=fixture-csrf") && req.headers["x-csrf-token"] === "fixture-csrf") {
          res.setHeader("Set-Cookie", "session=fixture-a; HttpOnly; Path=/"); res.writeHead(303, { Location: "/api/me" }); res.end(); return;
        }
        res.writeHead(401); res.end(html); return;
      }
      res.setHeader("Set-Cookie", "csrf=fixture-csrf; Path=/"); res.end(html); return;
    }
    if (["/api/me", "/account", "/profile", "/dashboard", "/api/auth/session", "/objects/41"].includes(u.pathname)) {
      res.setHeader("Content-Type", "application/json");
      if (!valid) { res.writeHead(401); res.end('{"error":"unauthorized"}'); return; }
      res.end(u.pathname === "/objects/41" ? '{"id":41,"ownerId":"account-a","name":"private synthetic document"}' : '{"id":"account-a","username":"tester","authenticated":true}'); return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(`<html><a href="/sign-in">Sign in</a><a href="/api/me">Account</a>${valid ? '<a href="/objects/41">Private object</a>' : ""}<a href="http://localhost:1/foreign">foreign</a><a href="/transfer">action</a></html>`);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening"); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; state.host = new URL(base).host;
  allowFixture(server);
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
beforeEach(() => { vi.stubEnv("AUTH_URL", "http://app.test"); state.rows.clear(); state.active = true; state.excluded = false; state.authorized = true; behavior = "normal"; seen.length = 0; });
describe("real black-box connection on controlled local fixtures", () => {
  it("discovers login, submits hidden/cookie/meta/header CSRF and proves an authenticated session", async () => {
    const row = store({ mode: "EMAIL_PASSWORD", cookiesCipher: null, emailCipher: encryptSecret("tester"), passwordCipher: encryptSecret(password) });
    const result = await testStoredConnection(row.targetId, row.id);
    expect(result.status).toBe("VALID");
    const saved = state.rows.get(row.id)!;
    expect(saved.loginUrl).toBe(base + "/sign-in"); expect(saved.validationUrl).toBe(base + "/api/me");
    expect(saved.ownedObjectUrl).toBe(base + "/objects/41");
    expect(saved.sessionCookiesCipher).not.toContain("fixture-a");
    expect((await loadTargetCredentials(row.targetId))).toHaveLength(1);
    expect(seen.some(r => r.method === "POST" && r.csrf === "fixture-csrf")).toBe(true);
    expect(seen.every(r => r.ua === "BlackBox-Required/1" && r.path !== "/transfer" && r.path !== "/foreign")).toBe(true);
    expect(JSON.stringify(result)).not.toContain(password); expect(JSON.stringify(result)).not.toContain("fixture-a");
  }, 30000);
  it("rejects a bad password even when CSRF cookies exist", async () => {
    const row = store({ mode: "EMAIL_PASSWORD", cookiesCipher: null, emailCipher: encryptSecret("tester"), passwordCipher: encryptSecret("wrong-fixture-password") });
    expect((await testStoredConnection(row.targetId, row.id)).status).toBe("INVALID");
    expect((await loadTargetCredentials(row.targetId))).toEqual([]);
    expect(state.rows.get(row.id)!.sessionCookiesCipher).toBeNull();
  }, 30000);
  it.each(["registration", "purchase"])("does not submit a %s form discovered during login", async mode => {
    behavior = mode;
    const row = store({ mode: "EMAIL_PASSWORD", cookiesCipher: null, emailCipher: encryptSecret("tester"), passwordCipher: encryptSecret(password) });
    expect((await testStoredConnection(row.targetId, row.id)).status).toBe("UNKNOWN");
    expect(seen.every(r => r.method === "GET")).toBe(true);
  }, 30000);
  it("confines POSTs to the exact detected action and requires credential data", () => {
    const guard = new ConnectionGuard({ targetId: "body-policy", host: state.host, requiredUserAgent: "BlackBox-Required/1", qualifying: [], nonQualifying: [] });
    try {
      const login = base + "/session?action=login";
      guard.allowLoginAction(login, true, "password");
      expect(() => guard.assertRequest(login, "POST", "username=tester")).toThrow("credential submissions");
      expect(() => guard.assertRequest(login, "POST", "username=tester&password=fixture")).not.toThrow();
      expect(() => guard.assertRequest(base + "/session?action=purchase", "POST", "password=fixture")).toThrow("Unsupported");
      expect(() => guard.assertRequest(base + "/session", "POST", "password=fixture")).toThrow("Unsupported");
    } finally { guard.close(); }
    expect(seen).toHaveLength(0);
  });
  it("validates a cookie using a protected resource and independently denied anonymous control", async () => {
    const row = store(); expect((await testStoredConnection(row.targetId, row.id)).status).toBe("VALID");
    expect(state.rows.get(row.id)!.validationUrl).toBe(base + "/api/me");
    expect(seen.every(r => r.method === "GET")).toBe(true);
    expect(seen[1].at - seen[0].at).toBeGreaterThanOrEqual(80);
  });
  it("marks expired cookies unusable and never silently supplies them to Hunt", async () => {
    const row = store({ cookiesCipher: encryptSecret(JSON.stringify({ session: "expired-fixture" })) });
    expect((await testStoredConnection(row.targetId, row.id)).status).toBe("EXPIRED");
    expect(await loadTargetCredentials(row.targetId)).toEqual([]);
  });
  it("does not equate public catch-all differences with authentication", async () => {
    behavior = "catchall"; const row = store();
    expect((await testStoredConnection(row.targetId, row.id)).status).toBe("UNKNOWN");
    expect(await loadTargetCredentials(row.targetId)).toEqual([]);
  });

  it.each(["removed", "excluded"])("refuses %s scope before any target request", async reason => {
    state.active = reason !== "removed"; state.excluded = reason === "excluded";
    const row = store(); await expect(testStoredConnection(row.targetId, row.id)).rejects.toThrow(); expect(seen).toHaveLength(0);
  });
  it("cancels real requests and leaves the session unverified", async () => {
    behavior = "slow"; const row = store(); const controller = new AbortController();
    const result = testStoredConnection(row.targetId, row.id, controller.signal); setTimeout(() => controller.abort(), 30);
    expect((await result).status).toBe("UNKNOWN"); expect(await loadTargetCredentials(row.targetId)).toEqual([]);
  });
  it("normalizes cookie headers in the test API, stores encryption and returns status only", async () => {
    const id = `api-target-${++state.serial}`;
    const r = await POST(new Request("http://app.test", { method: "POST", body: JSON.stringify({ mode: "COOKIES", cookies: "Cookie: session=fixture-a" }), headers: { "Content-Type": "application/json", Origin: "http://app.test" } }), { params: Promise.resolve({ id }) });
    expect(r.status).toBe(200); const body = await r.json(); expect(body.status).toBe("VALID");
    expect(JSON.stringify(body)).not.toMatch(/fixture-a|Cipher|password|Cookie/);
  });
  it("serializes connection checks and rejects concurrent checks on the same host", async () => {
    behavior = "slow"; const row = store(); const controller = new AbortController();
    const first = testStoredConnection(row.targetId, row.id, controller.signal);
    await new Promise(resolve => setTimeout(resolve, 20));
    await expect(testStoredConnection(row.targetId, row.id)).rejects.toThrow("CONNECTION_RATE_LIMIT");
    controller.abort(); await first;
  });
  it("never overwrites a newer invalidation with an older connection result", async () => {
    const row = store(); const pending = testStoredConnection(row.targetId, row.id);
    await new Promise(resolve => setTimeout(resolve, 40));
    const inFlight = state.rows.get(row.id)!;
    state.rows.set(row.id, { ...inFlight, sessionCheckId: "newer-check", sessionStatus: "INVALID" });
    expect((await pending).status).toBe("UNKNOWN");
    expect(state.rows.get(row.id)!.sessionStatus).toBe("INVALID");
  });
  it("rejects malformed cookies and unauthorized API requests before HTTP", async () => {
    const id = `api-target-${++state.serial}`;
    const request = () => new Request("http://app.test", { method: "POST", headers: { Origin: "http://app.test" }, body: JSON.stringify({ mode: "COOKIES", cookies: "bad\r\nCookie: fixture" }) });
    expect((await POST(request(), { params: Promise.resolve({ id }) })).status).toBe(400);
    state.authorized = false; expect((await POST(request(), { params: Promise.resolve({ id }) })).status).toBe(401);
    expect(seen).toHaveLength(0);
  });
});

afterEach(() => vi.unstubAllEnvs());
