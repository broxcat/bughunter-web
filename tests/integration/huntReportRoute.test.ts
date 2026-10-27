import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), findFirst: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { scanRun: { findFirst: mocks.findFirst } } }));
import { GET } from "@/app/api/scan-runs/[id]/hunt/route";
const get = () => GET(new Request("http://localhost/api/scan-runs/run/hunt"), { params: Promise.resolve({ id: "run" }) });
describe("owned historical Hunt reports", () => {
  beforeEach(() => vi.resetAllMocks());
  it("requires authentication", async () => { mocks.auth.mockResolvedValue(null); expect((await get()).status).toBe(401); expect(mocks.findFirst).not.toHaveBeenCalled(); });
  it("restricts both host and program ownership and hides absent/cross-user reports", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "owner" } }); mocks.findFirst.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect(mocks.findFirst.mock.calls[0][0].where).toEqual({ id: "run", type: "HUNT", target: { userId: "owner", OR: [{ program: null }, { program: { ownerId: "owner" } }] } });
  });
  it("keeps removed host history available without selecting credential columns", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "owner" } }); mocks.findFirst.mockResolvedValue({ id: "run", status: "COMPLETED", outcome: null, huntReport: { version: 1 } });
    const response = await get(); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).outcome).toBeNull();
    expect(mocks.findFirst.mock.calls[0][0].select).toMatchObject({ outcome: true });
    expect(JSON.stringify(mocks.findFirst.mock.calls[0][0])).not.toMatch(/credentials|encrypted|password|active/);
  });
});
