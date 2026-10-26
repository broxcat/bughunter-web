import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), ping: vi.fn(), disconnect: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: mocks.query } }));
vi.mock("@/server/queue/connection", () => ({ createRedisConnection: mocks.create }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
import { GET } from "@/app/api/health/route";
beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); mocks.query.mockResolvedValue(1); mocks.connect.mockResolvedValue(undefined); mocks.ping.mockResolvedValue("PONG"); mocks.create.mockReturnValue({ connect: mocks.connect, ping: mocks.ping, disconnect: mocks.disconnect }); });
afterEach(() => vi.useRealTimers());
describe("bounded public health checks", () => {
  it("reports both dependencies up and disposes the dedicated connection", async () => { const r = await GET(); expect(r.status).toBe(200); expect(await r.json()).toEqual({ status: "ok", db: "up", redis: "up" }); expect(mocks.disconnect).toHaveBeenCalledOnce(); });
  it("returns 503 promptly when Redis never connects instead of waiting forever", async () => {
    mocks.connect.mockReturnValue(new Promise(() => {})); const pending = GET(); await vi.advanceTimersByTimeAsync(1600); const r = await pending;
    expect(r.status).toBe(503); expect(await r.json()).toEqual({ status: "error", db: "up", redis: "down" }); expect(mocks.disconnect).toHaveBeenCalledOnce();
  });
  it("bounds PostgreSQL and Redis concurrently without leaking raw errors", async () => {
    mocks.query.mockReturnValue(new Promise(() => {})); mocks.ping.mockRejectedValue(new Error("private connection material")); const pending = GET(); await vi.advanceTimersByTimeAsync(1600); const r = await pending;
    expect(r.status).toBe(503); expect(await r.json()).toEqual({ status: "error", db: "down", redis: "down" });
  });
});
