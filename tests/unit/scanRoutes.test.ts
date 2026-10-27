import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), target: vi.fn(), create: vi.fn(), update: vi.fn(), list: vi.fn(), add: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { target: { findFirst: mocks.target }, scanRun: { create: mocks.create, update: mocks.update, findMany: mocks.list } } }));
vi.mock("@/server/queue/scanQueue", () => ({ scanQueue: { add: mocks.add } }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn(async () => ({ allowed: true })) }));
import { GET, POST } from "@/app/api/scan-runs/route";
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ user: { id: "owner" } }); });
const post = (type: string) => POST(new NextRequest("http://localhost/api/scan-runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetId: "target", type }) }));
describe("scan creation and legacy compatibility", () => {
  it("rejects VALIDATE explicitly without creating a scan or adding a job", async () => {
    const response = await post("VALIDATE");
    expect(response.status).toBe(400); expect((await response.json()).error).toMatch(/VALIDATE.*not supported/);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.add).not.toHaveBeenCalled(); expect(mocks.target).not.toHaveBeenCalled();
  });
  it.each(["RECON", "HUNT"])("continues to create %s with a null live outcome", async type => {
    mocks.target.mockResolvedValue({ id: "target", userId: "owner", host: "example.test", active: true, scope: { status: "APPROVED" }, program: { ownerId: "owner", requiredUserAgent: "Test/1", outOfScope: [] } });
    mocks.create.mockResolvedValue({ id: "run" }); mocks.add.mockResolvedValue({ id: "job" });
    mocks.update.mockResolvedValue({ id: "run", type, status: "QUEUED", outcome: null });
    const response = await post(type);
    expect(response.status).toBe(201); expect(await response.json()).toMatchObject({ type, status: "QUEUED", outcome: null });
    expect(mocks.add).toHaveBeenCalledWith("scan", { scanRunId: "run", targetId: "target", type });
  });
  it("lists historical unknown results and explicit partial results without changing fields", async () => {
    mocks.target.mockResolvedValue({ id: "target" });
    const rows = [{ id: "old", status: "COMPLETED", outcome: null }, { id: "new", status: "COMPLETED", outcome: "PARTIAL" }];
    mocks.list.mockResolvedValue(rows);
    const response = await GET(new NextRequest("http://localhost/api/scan-runs?targetId=target"));
    expect(response.status).toBe(200); expect(await response.json()).toEqual(rows);
  });
});
