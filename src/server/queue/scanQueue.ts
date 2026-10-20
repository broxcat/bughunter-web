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

// The Queue is built lazily on first use rather than at module import. BullMQ
// connects to Redis as soon as a Queue is constructed, so building it at import
// time made `next build` (which imports this module to collect page data) open a
// socket and log ECONNREFUSED when Redis isn't running. Deferring construction
// keeps import side-effect-free; the first real `scanQueue.*` access at request
// time builds it. The `scanQueue` export shape is preserved via a Proxy so callers
// keep using `scanQueue.add("scan", data)` unchanged.
let queueInstance: Queue<ScanJobData> | undefined;

function getScanQueue(): Queue<ScanJobData> {
  if (!queueInstance) {
    queueInstance = new Queue<ScanJobData>(SCAN_QUEUE_NAME, {
      connection: redis,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
  }
  return queueInstance;
}

export const scanQueue = new Proxy({} as Queue<ScanJobData>, {
  get(_target, prop, receiver) {
    const q = getScanQueue();
    const value = Reflect.get(q as object, prop, receiver);
    return typeof value === "function" ? value.bind(q) : value;
  },
});
