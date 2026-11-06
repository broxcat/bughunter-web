import { logger } from "@/lib/logger";
import { reconcileScanExecutions } from "./executionAttempts";
import { settleQueuedCancellations } from "./scanCancellation";
import { HEARTBEAT_INTERVAL_MS } from "./executionAttempts";

export async function maintainScanExecutions() { await reconcileScanExecutions(); await settleQueuedCancellations(); const {maintainTargetRecons}=await import('../recon/targetRuns');await maintainTargetRecons(); const {maintainResearchPlans}=await import('../research/plans');await maintainResearchPlans(); const {maintainReconHistory}=await import('../recon/history');await maintainReconHistory(); }
export function startExecutionMaintenance() {
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> = Promise.resolve();
  const tick = async () => {
    try { await maintainScanExecutions(); } catch { logger.warn({ reason: "EXECUTION_RECONCILIATION_DEFERRED" }, "execution maintenance will retry"); }
    finally { if (!stopped) timer = setTimeout(() => { pending = tick(); }, HEARTBEAT_INTERVAL_MS); }
  };
  pending = tick();
  return { async close() { stopped = true; clearTimeout(timer); await pending; } };
}
