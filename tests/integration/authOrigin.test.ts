import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.findUnique } } }));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("AUTH_SECRET", "auth-origin-regression-test-secret-only");
  vi.stubEnv("AUTH_URL", "");
  vi.stubEnv("NEXTAUTH_URL", "");
  vi.stubEnv("GITHUB_ID", "");
  vi.stubEnv("GOOGLE_CLIENT_ID", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("public authentication origin", () => {
  it("requires an explicit public URL for Docker instead of shipping a localhost default", () => {
    const example = readFileSync(".env.example", "utf8");
    expect(example.match(/^AUTH_URL="(.*)"$/m)?.[1]).toBe("");
    const compose = readFileSync("docker-compose.yml", "utf8");
    const web = compose.split("  web:\n")[1].split("  worker:\n")[0];
    expect(web).toContain("${AUTH_URL:?");
  });

  it.each([
    ["http://100.121.43.68:3000", "/targets", true],
    ["http://example.test:3000", "/settings", true],
    ["http://localhost:3000", "/reports", true],
    ["http://example.test:3000", "/targets", false],
    ["https://example.test", "/settings", true],
  ])("login → session → logout on %s from %s (configured: %s)", async (origin, route, configured) => {
    if (configured) vi.stubEnv("AUTH_URL", origin);
    mocks.findUnique.mockResolvedValue({
      id: "origin-test-user", email: "origin@example.test", name: "Origin test",
      image: null, passwordHash: await bcrypt.hash("fixture-password", 4),
    });
    const { GET, POST } = await import("@/app/api/auth/[...nextauth]/route");
    const cookies = new Map<string, string>();
    // A configured public origin must win even when Next.js sees an internal URL.
    const internalOrigin = configured ? "http://localhost:3000" : origin;
    async function request(action: string, body?: Record<string, string>) {
      const headers = new Headers({
        host: new URL(internalOrigin).host,
        "x-forwarded-host": new URL(origin).host,
        "x-forwarded-proto": new URL(origin).protocol.slice(0, -1),
        cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; "),
        referer: `${origin}${route}`,
      });
      if (body) {
        headers.set("Content-Type", "application/x-www-form-urlencoded");
        headers.set("X-Auth-Return-Redirect", "1");
      }
      const req = new NextRequest(`${internalOrigin}/api/auth/${action}`, {
        method: body ? "POST" : "GET", headers,
        ...(body ? { body: new URLSearchParams(body) } : {}),
      });
      const response = await (body ? POST(req) : GET(req));
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(";", 1)[0];
        const index = pair.indexOf("=");
        const key = pair.slice(0, index), value = pair.slice(index + 1);
        if (value) cookies.set(key, value);
        else cookies.delete(key);
      }
      expect(response.status).toBe(200);
      return response.json();
    }

    const { csrfToken } = await request("csrf");
    const login = await request("callback/credentials", {
      csrfToken, email: "origin@example.test", password: "fixture-password", callbackUrl: route,
    });
    expect(login.url).toBe(`${origin}${route}`);
    expect((await request("session")).user.id).toBe("origin-test-user");
    const logout = await request("signout", { csrfToken, callbackUrl: "/login" });
    expect(logout.url).toBe(`${origin}/login`);
    if (!origin.includes("localhost")) expect(logout.url).not.toContain("localhost");
    expect(await request("session")).toBeNull();
  });
});
