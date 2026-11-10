import { Worker } from "bullmq";
import { redis } from "./connection";
import { SCAN_QUEUE_NAME, type ScanJobData } from "./scanQueue";
import { startScanDispatcher } from "./scanDispatcher";
import { createScanProcessor } from "./processScan";
import { workerIdentity } from "./executionAttempts";
import { maintainScanExecutions, startExecutionMaintenance } from "./executionMaintenance";
import { settlesWithin } from "@/server/scanControl";
import { logger } from "@/lib/logger";
import { RECON_CAPACITY } from '@/lib/reconPlanner';

import { collectReconDoctor } from '../recon/toolchain';
import { startReconSummaryWorker } from '../recon/summaries';
import { startCampaignMaintenance } from '../campaignMaintenance';
import { startResourceGarbageCollector } from '../resourceGarbageCollector';
let collector: ReturnType<typeof startResourceGarbageCollector> | undefined;
let summaries:ReturnType<typeof startReconSummaryWorker>|undefined;
const workerId = workerIdentity();
const processor = createScanProcessor(workerId);
// Keep normal lock renewal/stall detection. PostgreSQL, not maxStalledCount,
// prevents network replay. BullMQ close() alone would wait indefinitely for work.
const worker = new Worker<ScanJobData>(SCAN_QUEUE_NAME, (job, token, signal) => processor.process(job, signal, token), {
  connection: redis, concurrency: RECON_CAPACITY.globalAssets, autorun: false, maxStalledCount: 1,
});
let dispatcher: ReturnType<typeof startScanDispatcher> | undefined;
let maintenance: ReturnType<typeof startExecutionMaintenance> | undefined;
let campaigns: ReturnType<typeof startCampaignMaintenance> | undefined;
let closing = false;
export const ready = (async () => {
  collector = startResourceGarbageCollector();
  const doctor=await collectReconDoctor();
  if(!doctor.ready)throw new Error('Recon worker execution prerequisites are not ready');
  logger.info({workerId,manifest:doctor.fingerprint,readiness:doctor.ready},'Recon Doctor validated worker execution infrastructure');
  await maintainScanExecutions(); // Reconcile durable state before accepting work.
  if (closing) return;
  summaries=startReconSummaryWorker();
  dispatcher = startScanDispatcher();
  maintenance = startExecutionMaintenance();
  campaigns = startCampaignMaintenance();
  void worker.run().catch(() => logger.error({ workerId, reason: "WORKER_RUN_FAILED" }, "worker stopped processing"));
})();
ready.catch(() => { logger.error({ workerId, reason: "WORKER_STARTUP_FAILED" }, "worker reconciliation failed at startup"); void shutdown(); });
worker.on("failed", job => logger.warn({ workerId, scanRunId: job?.data.scanRunId, reason: "BULLMQ_JOB_FAILED" }, "worker job failed"));
worker.on("stalled", jobId => logger.warn({ workerId, scanRunId: jobId, reason: "BULLMQ_STALLED" }, "job stalled; durable execution guard will refuse replay"));
worker.on("lockRenewalFailed", ids => { for (const id of ids) processor.interrupt(id, "WORKER_LOCK_LOST"); });
worker.on("error", () => logger.warn({ workerId, reason: "BULLMQ_CONNECTION_ERROR" }, "worker queue connection error"));
worker.on("ready", () => logger.info({ workerId }, "worker ready"));
async function shutdown() {
  if (closing) return;
  closing = true;
  processor.stopAccepting();
  logger.info({ workerId, reason: "WORKER_SHUTDOWN" }, "worker stopping; active executions will be interrupted");
  // Stop acquisition immediately. No new network start is allowed by processor.
  void worker.pause(true).catch(() => {});
  await Promise.all([
    processor.shutdown(),
    summaries?.close(),
    settlesWithin(Promise.all([dispatcher?.close(), maintenance?.close(), campaigns?.close(), collector?.close()]), 2000),
  ]);
  await settlesWithin(worker.close(true), 2000);
  redis.disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
export { worker };
