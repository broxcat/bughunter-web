// The single BullMQ queue for scan jobs. UI code enqueues with:
//   scanQueue.add("scan", { scanRunId, targetId, type })
//
// Scans have real, irreversible side effects (they spawn tools against a live
// host), so jobs are NOT retry-safe: `attempts: 1`. A failed scan surfaces as a
// FAILED ScanRun, never a silent re-run.

import { Queue } from "bullmq";
import { redis } from "./connection";

export const SCAN_QUEUE_NAME = "scans";

/** Payload for a scan job. The frozen QUEUE ↔ UI contract. */
export type ScanJobData = {
  scanRunId: string;
  targetId: string;
  type: "RECON" | "HUNT" | "VALIDATE";
};

export const scanQueue = new Queue<ScanJobData>(SCAN_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});
