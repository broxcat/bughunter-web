import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), target: vi.fn(), create: vi.fn(), update: vi.fn(), list: vi.fn(), publish: vi.fn(), replay: vi.fn(), accept: vi.fn(), find: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { target: { findFirst: mocks.target }, scanRun: { create: mocks.create, update: mocks.update, findMany: mocks.list, findUnique: mocks.find } } }));
vi.mock("@/server/queue/scanJobPublisher", () => ({ publishScanJob: mocks.publish, dispatchSelect: { status: true } }));
vi.mock("@/server/queue/scanRequest", async importOriginal => ({ ...await importOriginal<object>(), createScanRequest: mocks.accept, findScanRequest: mocks.replay }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn(async () => ({ allowed: true })) }));
import { GET, POST } from "@/app/api/scan-runs/route";
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ user: { id: "owner" } }); mocks.find.mockResolvedValue(null); });
const post = (type: string, key?: string) => POST(new NextRequest("http://localhost/api/scan-runs", { method: "POST", headers: { "Content-Type": "application/json", ...(key !== undefined ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify({ targetId: "target", type }) }));
describe("scan creation and legacy compatibility", () => {
  it("rejects VALIDATE explicitly without creating a scan or adding a job", async () => {
    const response = await post("VALIDATE");
    expect(response.status).toBe(400); expect((await response.json()).error).toMatch(/VALIDATE.*not supported/);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.accept).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled(); expect(mocks.target).not.toHaveBeenCalled();
  });
  it.each(["RECON", "HUNT"])("continues to create %s with a null live outcome", async type => {
    mocks.target.mockResolvedValue({ id: "target", userId: "owner", host: "example.test", active: true, scope: { status: "APPROVED" }, program: { ownerId: "owner", requiredUserAgent: "Test/1", outOfScope: [] } });
    mocks.accept.mockResolvedValue({ id: "run", targetId: "target", type, status: "QUEUED", outcome: null, jobId: null });
    mocks.publish.mockResolvedValue({ dispatch: "PUBLISHED" });
    const response = await post(type);
    expect(response.status).toBe(201); expect(await response.json()).toMatchObject({ type, status: "QUEUED", outcome: null });
    expect(mocks.accept).toHaveBeenCalledWith("owner", { targetId: "target", type, approvedTechniques: [] }, null);
    expect(mocks.publish).toHaveBeenCalledWith("run");
  });
  it("returns accepted work as 202 while queue delivery is pending", async () => {
    mocks.replay.mockResolvedValue({ id: "run", status: "QUEUED", outcome: null, jobId: null });
    mocks.publish.mockResolvedValue({ dispatch: "PENDING" });
    const response = await post("RECON", "retry-key");
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ id: "run", status: "QUEUED", outcome: null, dispatch: "PENDING" });
    expect(mocks.accept).not.toHaveBeenCalled();
  });
  it.each(["", "has space", "x".repeat(129), "clé"])("rejects invalid idempotency key %s", async key => {
    expect((await post("RECON", key)).status).toBe(400);
    expect(mocks.accept).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("returns 500 only when acceptance fails before commit", async () => {
    mocks.replay.mockRejectedValue(new Error("database unavailable"));
    expect((await post("RECON", "key")).status).toBe(500);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("lists historical unknown results and explicit partial results without changing fields", async () => {
    mocks.target.mockResolvedValue({ id: "target" });
    const rows = [{ id: "old", status: "COMPLETED", outcome: null }, { id: "new", status: "COMPLETED", outcome: "PARTIAL" }];
    mocks.list.mockResolvedValue(rows);
    const response = await GET(new NextRequest("http://localhost/api/scan-runs?targetId=target"));
    expect(response.status).toBe(200); expect(await response.json()).toEqual(rows.map(row => ({ ...row, dispatch: null, execution: null })));
  });
});
