// Standalone BullMQ entrypoint. The processor is separate so it can be tested
// without starting Redis connections or installing process signal handlers.
import { Worker } from "bullmq";
import { redis } from "./connection";
import { SCAN_QUEUE_NAME, type ScanJobData } from "./scanQueue";
import { processScan } from "./processScan";
import { logger, scanLogger } from "@/lib/logger";

const worker = new Worker<ScanJobData>(SCAN_QUEUE_NAME, processScan, {
  connection: redis,
  concurrency: 1,
});

worker.on("failed", (job, err) => {
  const scanRunId = job?.data?.scanRunId;
  const log = scanRunId ? scanLogger(scanRunId) : logger;
  log.error({ jobId: job?.id, err: err?.message ?? err }, "worker job failed");
});

worker.on("ready", () => {
  logger.info(`worker ready — processing "${SCAN_QUEUE_NAME}" (concurrency 1)`);
});

async function shutdown(signal: string) {
  logger.info(`worker ${signal} received, closing...`);
  await worker.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

export { worker };
