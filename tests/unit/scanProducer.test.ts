import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ connect: vi.fn(), disconnect: vi.fn(), redis: vi.fn(), queue: vi.fn(), getJob: vi.fn(), add: vi.fn(), close: vi.fn() }));
vi.mock("ioredis", () => ({ Redis: class {
  constructor(...args: unknown[]) { mocks.redis(...args); }
  on() {} connect = mocks.connect; disconnect = mocks.disconnect;
} }));
vi.mock("bullmq", () => ({ Queue: class {
  constructor(...args: unknown[]) { mocks.queue(...args); }
  on() {} getJob = mocks.getJob; add = mocks.add; close = mocks.close;
} }));
import { deliverScanJob, PRODUCER_DEADLINE_MS, PRODUCER_REDIS_OPTIONS, SCAN_JOB_OPTIONS } from "@/server/queue/scanQueue";
const data = { scanRunId: "cuid-test", targetId: "target", type: "RECON" as const };
beforeEach(() => { vi.resetAllMocks(); mocks.connect.mockResolvedValue(undefined); mocks.getJob.mockResolvedValue(undefined); mocks.add.mockResolvedValue({ id: data.scanRunId }); mocks.close.mockResolvedValue(undefined); });
afterEach(() => vi.useRealTimers());
describe("bounded BullMQ producer", () => {
  it("uses finite producer policies, deterministic IDs, and no execution retries", async () => {
    expect(await deliverScanJob(data)).toEqual({ alreadyPresent: false });
    expect(mocks.redis.mock.calls[0][1]).toBe(PRODUCER_REDIS_OPTIONS);
    expect(PRODUCER_REDIS_OPTIONS).toMatchObject({ maxRetriesPerRequest: 0, enableOfflineQueue: false, connectTimeout: 500, commandTimeout: 500, autoResendUnfulfilledCommands: false });
    expect(PRODUCER_REDIS_OPTIONS.retryStrategy()).toBeNull();
    expect(mocks.queue.mock.calls[0][1].defaultJobOptions).toBe(SCAN_JOB_OPTIONS);
    expect(SCAN_JOB_OPTIONS.attempts).toBe(1);
    expect(mocks.add).toHaveBeenCalledWith("scan", data, { jobId: data.scanRunId });
    expect(mocks.disconnect).toHaveBeenCalledOnce(); expect(mocks.close).toHaveBeenCalledOnce();
  });
  it("confirms an existing job without adding another", async () => {
    mocks.getJob.mockResolvedValue({ name: "scan", data });
    expect(await deliverScanJob(data)).toEqual({ alreadyPresent: true });
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it("rejects a conflicting job payload without delivering unsafe work", async () => {
    mocks.getJob.mockResolvedValue({ name: "scan", data: { ...data, targetId: "foreign" } });
    await expect(deliverScanJob(data)).rejects.toThrow("identity mismatch");
    expect(mocks.add).not.toHaveBeenCalled(); expect(mocks.disconnect).toHaveBeenCalledOnce();
  });
  it("bounds even a readiness promise that never settles and disposes its socket", async () => {
    vi.useFakeTimers(); mocks.connect.mockReturnValue(new Promise(() => {}));
    const result = expect(deliverScanJob(data)).rejects.toThrow("deadline");
    await vi.advanceTimersByTimeAsync(PRODUCER_DEADLINE_MS + 1); await result;
    expect(mocks.disconnect).toHaveBeenCalledOnce(); expect(mocks.add).not.toHaveBeenCalled();
  });
  it("BullMQ cleanup cannot extend the producer deadline", async () => {
    mocks.close.mockReturnValue(new Promise(() => {}));
    expect(await deliverScanJob(data)).toEqual({ alreadyPresent: false });
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });
  it("late completion after a deadline cannot add a background job", async () => {
    vi.useFakeTimers(); let release!: (job: undefined) => void;
    mocks.getJob.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const result = expect(deliverScanJob(data)).rejects.toThrow("deadline");
    await vi.advanceTimersByTimeAsync(PRODUCER_DEADLINE_MS + 1); await result;
    release(undefined); await vi.advanceTimersByTimeAsync(1);
    expect(mocks.add).not.toHaveBeenCalled(); expect(mocks.disconnect).toHaveBeenCalledOnce();
  });
});
