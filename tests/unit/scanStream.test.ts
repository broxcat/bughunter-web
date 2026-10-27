import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), find: vi.fn(), logs: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { scanRun: { findUnique: mocks.find }, scanLog: { findMany: mocks.logs } } }));
vi.mock("@/server/queue/logBus", () => ({ subscribeScanLog: mocks.subscribe }));
import { GET } from "@/app/api/scan-runs/[id]/stream/route";
const get = () => GET(new Request("http://localhost/api/scan-runs/run/stream"), { params: Promise.resolve({ id: "run" }) });
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ user: { id: "owner" } }); mocks.logs.mockResolvedValue([]); mocks.subscribe.mockResolvedValue(mocks.unsubscribe); });
afterEach(() => vi.useRealTimers());
describe("scan SSE result", () => {
  it.each(["SUCCESS", "PARTIAL", null])("replays terminal outcome %s including historical unknown", async outcome => {
    mocks.find.mockResolvedValue({ status: "COMPLETED", outcome, target: { userId: "owner" } });
    const response = await get();
    expect(await response.text()).toContain(`data: ${JSON.stringify({ status: "COMPLETED", outcome })}`);
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });
  it("emits the actual live status, then includes outcome on termination and cleans up", async () => {
    vi.useFakeTimers();
    mocks.find.mockResolvedValueOnce({ status: "QUEUED", outcome: null, target: { userId: "owner" } }).mockResolvedValue({ status: "COMPLETED", outcome: "PARTIAL" });
    const response = await get(); const reader = response.body!.getReader(); const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toContain('"status":"QUEUED","outcome":null');
    await vi.advanceTimersByTimeAsync(2000);
    let text = "";
    for (;;) { const next = await reader.read(); if (next.done) break; text += decoder.decode(next.value); }
    expect(text).toContain('"status":"COMPLETED","outcome":"PARTIAL"');
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
});
