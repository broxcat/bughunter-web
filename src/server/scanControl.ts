import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "@/lib/logger";

export type ScanStopReason = "USER_CANCELLED" | "WORKER_SHUTDOWN" | "WORKER_LOCK_LOST" | "EXECUTION_LOST" | "HEARTBEAT_LOST";
export class ScanAbortError extends Error {
  constructor(public readonly reason: ScanStopReason) { super(reason); }
}
export async function settlesWithin(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work.then(() => true, () => false), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), ms); })]); }
  finally { clearTimeout(timer); }
}

type StopResource = (force: boolean) => Promise<void>;
export class ScanControl {
  readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private resources = new Map<StopResource, Promise<void> | null>();
  constructor(readonly identity: { scanRunId: string; attemptId: string; workerId: string }, private readonly mark: (kind: "networkStartedAt" | "usefulWorkAt") => Promise<void>) {}
  abort(reason: ScanStopReason) {
    if (!this.signal.aborted) {
      this.controller.abort(new ScanAbortError(reason));
      logger.info({ ...this.identity, reason }, "scan execution stop requested");
    }
    for (const [stop, pending] of this.resources) if (!pending) this.stopResource(stop, false);
  }
  assertActive() { this.signal.throwIfAborted(); }
  async activity(kind: "networkStartedAt" | "usefulWorkAt") {
    this.assertActive();
    try { await this.mark(kind); } catch { this.abort("HEARTBEAT_LOST"); }
    this.assertActive();
  }
  track(stop: StopResource): () => void {
    this.resources.set(stop, null);
    if (this.signal.aborted) this.stopResource(stop, false);
    return () => { this.resources.delete(stop); };
  }
  private stopResource(stop: StopResource, force: boolean) {
    // Attach a rejection handler immediately; cleanup will still report failure.
    const pending = Promise.resolve().then(() => stop(force));
    pending.catch(() => {});
    this.resources.set(stop, pending);
    return pending;
  }
  async cleanup(force = false, timeoutMs = 2000): Promise<boolean> {
    const work = [...this.resources].map(([stop, pending]) => force || !pending ? this.stopResource(stop, force) : pending);
    return settlesWithin(Promise.all(work), timeoutMs);
  }
}
const storage = new AsyncLocalStorage<ScanControl>();
export function withScanControl<T>(control: ScanControl, work: () => T): T { return storage.run(control, work); }
export function currentScanControl(): ScanControl | undefined { return storage.getStore(); }
export function throwIfScanAborted() { currentScanControl()?.assertActive(); }
export async function beforeScanNetwork() { await currentScanControl()?.activity("networkStartedAt"); }
export async function recordUsefulScanWork() { await currentScanControl()?.activity("usefulWorkAt"); }
