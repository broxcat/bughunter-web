import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), cancel: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/server/queue/scanCancellation", () => ({ requestScanCancellation: mocks.cancel }));
import { POST } from "@/app/api/scan-runs/[id]/cancel/route";
const post = () => POST(new Request("http://localhost/api/scan-runs/run/cancel", { method: "POST", headers: { Origin: "http://localhost" } }), { params: Promise.resolve({ id: "run" }) });
beforeEach(() => { vi.stubEnv("AUTH_URL", "http://localhost"); vi.resetAllMocks(); mocks.auth.mockResolvedValue({ user: { id: "owner" } }); });
describe("durable scan cancellation API", () => {
  it("requires a session", async () => { mocks.auth.mockResolvedValue(null); expect((await post()).status).toBe(401); expect(mocks.cancel).not.toHaveBeenCalled(); });
  it("hides absent and foreign scans", async () => { mocks.cancel.mockResolvedValue({ kind: "NOT_FOUND" }); expect((await post()).status).toBe(404); expect(mocks.cancel).toHaveBeenCalledWith("run", "owner"); });
  it.each(["QUEUED", "RUNNING"])("accepts %s without claiming that traffic already stopped", async status => {
    const date = new Date(); mocks.cancel.mockResolvedValue({ kind: "REQUESTED", run: { status, cancelRequestedAt: date } });
    const response = await post(); expect(response.status).toBe(202); expect(await response.json()).toEqual({ id: "run", status, cancelRequestedAt: date.toISOString(), cancellation: "REQUESTED" });
  });
  it("repeated confirmed cancellation is idempotent", async () => { mocks.cancel.mockResolvedValue({ kind: "CANCELLED", run: { status: "CANCELLED", cancelRequestedAt: new Date() } }); expect((await post()).status).toBe(200); });
  it("completed/failed scans return a conflict", async () => { mocks.cancel.mockResolvedValue({ kind: "TERMINAL" }); expect((await post()).status).toBe(409); });
});

afterEach(() => vi.unstubAllEnvs());
