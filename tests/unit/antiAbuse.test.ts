import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({ limit: vi.fn(), find: vi.fn(), create: vi.fn(), hash: vi.fn(), compare: vi.fn(), config: undefined as unknown as import("next-auth").NextAuthConfig }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: mocks.limit }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.find, create: mocks.create }, account: { findUnique: mocks.find } } }));
vi.mock("bcryptjs", () => ({ default: { hash: mocks.hash, compare: mocks.compare } }));
vi.mock("next-auth", async original => ({ ...await original<object>(), default: (config: import("next-auth").NextAuthConfig) => { mocks.config = config; return {}; } }));
import "@/lib/auth";
import { POST } from "@/app/api/register/route";
import { guardCredentials, credentialsResponse } from "@/lib/credentialsGuard";
import { loginAccountKey, RATE_LIMIT_POLICIES } from "@/lib/abusePolicy";
const req = (email = " Known@Example.test ") => new Request("https://app.test/api/register", { method: "POST", headers: { "content-type": "application/json", origin: "https://app.test", "x-forwarded-for": "203.0.113.1", "x-real-ip": "203.0.113.2" }, body: JSON.stringify({ name: "Fixture", email, password: "valid-fixture-password" }) });
function authorize(email = " Known@Example.test ") {
  const provider = mocks.config.providers.find(provider => typeof provider !== "function" && provider.id === "credentials") as unknown as { options: { authorize: (raw: object, request: Request) => Promise<unknown> } };
  return provider.options.authorize({ email, password: "fixture-password" }, req());
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("AUTH_SECRET", "private-server-fixture-secret"); vi.stubEnv("TRUST_PROXY_HEADERS", "false"); vi.stubEnv("ALLOW_PUBLIC_REGISTRATION", "true");
  mocks.limit.mockResolvedValue({ status: "ALLOWED", resetSec: 900, remaining: 4 });
  mocks.hash.mockResolvedValue("fixture-hash"); mocks.compare.mockResolvedValue(false); mocks.find.mockResolvedValue(null); mocks.create.mockResolvedValue({ id: "user" });
});
afterEach(() => vi.unstubAllEnvs());
describe("operation-specific anti-abuse", () => {
  it("uses HMAC of normalized login without disclosing the email", () => {
    const key = loginAccountKey(" Known@Example.test ");
    expect(key).toBe(loginAccountKey("known@example.test")); expect(key).toMatch(/^rl:login:account:[a-f0-9]{64}$/);
    expect(key).not.toContain("known"); vi.stubEnv("AUTH_SECRET", "another-secret"); expect(loginAccountKey("known@example.test")).not.toBe(key);
  });
  it.each(["ALLOWED", "BLOCKED", "UNAVAILABLE"])("uses both dimensions before bcrypt: %s", async status => {
    mocks.limit.mockResolvedValue({ status, resetSec: 25, remaining: 0 });
    if (status === "ALLOWED") await expect(authorize()).resolves.toBeNull();
    else await expect(authorize()).rejects.toMatchObject({ code: status === "BLOCKED" ? "rate_limited" : "temporarily_unavailable" });
    expect(mocks.limit).toHaveBeenCalledWith("rl:login:ip:unknown", RATE_LIMIT_POLICIES.loginIp.limit, 900);
    expect(mocks.limit).toHaveBeenCalledWith(loginAccountKey("known@example.test"), RATE_LIMIT_POLICIES.loginAccount.limit, 900);
    if (status !== "ALLOWED") { expect(mocks.compare).not.toHaveBeenCalled(); expect(mocks.find).not.toHaveBeenCalled(); }
    else expect(mocks.compare).toHaveBeenCalledOnce();
  });
  it("blocks distributed account attacks even with an available IP budget", async () => {
    mocks.limit.mockImplementation(async (key: string) => ({ status: key.includes(":account:") ? "BLOCKED" : "ALLOWED", resetSec: 70 }));
    await expect(authorize()).rejects.toMatchObject({ code: "rate_limited" }); expect(mocks.compare).not.toHaveBeenCalled();
  });
  it("limits invalid login identifiers by IP before any password work", async () => {
    await expect(authorize("invalid-email")).resolves.toBeNull(); expect(mocks.limit).toHaveBeenCalledOnce(); expect(mocks.compare).not.toHaveBeenCalled();
  });
  it.each([null, { passwordHash: null }, { passwordHash: "stored-hash" }])("checks bcrypt for existent and nonexistent accounts", async account => {
    mocks.find.mockResolvedValue(account); await authorize(); expect(mocks.compare).toHaveBeenCalledOnce();
    expect(mocks.find).toHaveBeenCalledWith({ where: { email: "known@example.test" } });
  });
  it("refuses malformed trusted-proxy chains instead of granting an extra unknown-IP budget", async () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "true");
    const malformed = new Request("http://localhost", { headers: { "x-forwarded-for": "invalid, 192.0.2.5" } });
    await expect(guardCredentials(malformed, "known@example.test")).rejects.toMatchObject({ code: "temporarily_unavailable" });
    expect(mocks.limit).not.toHaveBeenCalled(); expect(mocks.compare).not.toHaveBeenCalled();
  });
  it("does not bypass the guard when a server secret is missing", async () => {
    vi.stubEnv("AUTH_SECRET", ""); await expect(authorize()).rejects.toMatchObject({ code: "temporarily_unavailable" }); expect(mocks.compare).not.toHaveBeenCalled();
  });
  it.each([["BLOCKED", 429], ["UNAVAILABLE", 503]] as const)("reports %s as HTTP %s with a generic message", async (status, expected) => {
    mocks.limit.mockResolvedValue({ status, resetSec: 65 });
    const response = await credentialsResponse(req(), async () => {
      await guardCredentials(req(), "known@example.test").catch(() => {}); // Auth.js catches CredentialsSignin too.
      return Response.json({ url: "https://app.test/login" });
    });
    expect(response.status).toBe(expected); expect(response.headers.get("Retry-After")).toBeTruthy();
    const body = await response.json(); expect(body.error).not.toMatch(/Redis|known@example/i); expect(body.url).toMatch(/CredentialsSignin/);
  });
  it("isolates denial metadata between concurrent requests", async () => {
    mocks.limit.mockImplementation(async (key: string) => ({ status: key === loginAccountKey("blocked@example.test") ? "BLOCKED" : "ALLOWED", resetSec: 40 }));
    const responses = await Promise.all(["blocked@example.test", "allowed@example.test"].map(email => credentialsResponse(req(), async () => { await guardCredentials(req(), email).catch(() => {}); return Response.json({}); })));
    expect(responses.map(res => res.status)).toEqual([429, 200]);
  });
});
describe("private and non-enumerating registration", () => {
  it.each([undefined, "false", "TRUE"])("disables registration by default/policy %s before DB/password work", async flag => {
    vi.stubEnv("ALLOW_PUBLIC_REGISTRATION", flag); expect((await POST(req())).status).toBe(403);
    expect(mocks.limit).not.toHaveBeenCalled(); expect(mocks.find).not.toHaveBeenCalled(); expect(mocks.hash).not.toHaveBeenCalled();
  });
  it("uses the same response and hash cost for new and existing email", async () => {
    const first = await POST(req()); mocks.find.mockResolvedValue({ id: "existing" }); const second = await POST(req());
    expect([first.status, second.status]).toEqual([200, 200]); expect(await first.json()).toEqual(await second.json());
    expect(mocks.hash).toHaveBeenCalledTimes(2); expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.create.mock.calls[0][0].data.email).toBe("known@example.test");
    // B3: registration is rate limited (per client and globally) before hashing.
    expect(mocks.limit).toHaveBeenCalledWith("rl:register:global", RATE_LIMIT_POLICIES.registerGlobal.limit, RATE_LIMIT_POLICIES.registerGlobal.windowSec);
  });
  it("conceals duplicate creation races, too", async () => {
    mocks.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "fixture" }));
    const response = await POST(req()); expect(response.status).toBe(200); expect(await response.text()).not.toMatch(/exists|duplicate|known@/);
  });
  it("returns generic DB failures, never secrets or query data", async () => {
    mocks.create.mockRejectedValue(new Error("secret database URL")); const response = await POST(req()); expect(response.status).toBe(500); expect(await response.text()).not.toMatch(/secret|database/);
  });
  it("gates new OAuth accounts in private mode while keeping linked accounts", async () => {
    vi.stubEnv("ALLOW_PUBLIC_REGISTRATION", "false");
    const callback = mocks.config.callbacks!.signIn!;
    const args = { user: { id: "oauth" }, account: { type: "oauth", provider: "github", providerAccountId: "fixture" } } as Parameters<typeof callback>[0];
    expect(await callback(args)).toBe(false); mocks.find.mockResolvedValue({ id: "linked" }); expect(await callback(args)).toBe(true);
  });
});
