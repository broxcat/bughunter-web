import { createServer, type Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rateLimit } from "@/lib/rateLimit";
import { assertRequiredEnv } from "@/lib/env";
afterEach(() => vi.unstubAllEnvs());
describe("bounded anti-abuse failures", () => {
  it("reports unavailable rather than allow when Redis accepts TCP but never replies", async () => {
    const sockets = new Set<Socket>();
    const server = createServer(socket => { sockets.add(socket); socket.on("error", () => {}); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    vi.stubEnv("REDIS_URL", `redis://127.0.0.1:${address.port}`);
    try {
      const start = Date.now();
      expect(await rateLimit("rl:fixture", 5, 60)).toEqual({ status: "UNAVAILABLE" });
      expect(Date.now() - start).toBeLessThan(1600);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  it("fails closed even if the Redis configuration is malformed", async () => {
    vi.stubEnv("REDIS_URL", "redis://invalid:badport");
    expect(await rateLimit("rl:fixture", 1, 60)).toEqual({ status: "UNAVAILABLE" });
  });
  it.each(["TRUST_PROXY_HEADERS", "ALLOW_PUBLIC_REGISTRATION"])("rejects ambiguous operator flags for %s", flag => {
    vi.stubEnv("AUTH_SECRET", "fixture"); vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", "a".repeat(64)); vi.stubEnv(flag, "yes");
    expect(() => assertRequiredEnv()).toThrow(flag);
  });
  it("rejects invalid ingress hop configuration at startup", () => {
    vi.stubEnv("AUTH_SECRET", "fixture"); vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", "a".repeat(64)); vi.stubEnv("TRUSTED_PROXY_HOPS", "0");
    expect(() => assertRequiredEnv()).toThrow("TRUSTED_PROXY_HOPS");
  });
});
