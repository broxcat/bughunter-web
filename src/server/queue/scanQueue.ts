import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
// Queue identity/options are shared; producer connections are never shared with
// the persistent blocking worker connection.
import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";

export const SCAN_QUEUE_NAME = "scans";
export type ScanJobData = {
  scanRunId: string;
  targetId: string;
  type: "RECON" | "HUNT" | "VALIDATE";
};
export const SCAN_JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} satisfies JobsOptions;
export const PRODUCER_DEADLINE_MS = 1500;
export const PRODUCER_REDIS_OPTIONS = {
  lazyConnect: true,
  connectTimeout: 500,
  commandTimeout: 500,
  maxRetriesPerRequest: 0,
  enableOfflineQueue: false,
  autoResendUnfulfilledCommands: false,
  retryStrategy: () => null,
};

export async function purgeScanJobs(ids: string[]) {
  if (!ids.length) return;
  const client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', PRODUCER_REDIS_OPTIONS);
  client.on('error', () => {});
  let queue: Queue | undefined;
  try {
    await client.connect();
    queue = new Queue(SCAN_QUEUE_NAME, { connection: client });
    for (const id of ids) {
      const deadline = Date.now() + 5000;
      while (true) {
        const job = await queue.getJob(id);
        if (!job) break;
        // The worker commits cleanup before BullMQ acknowledges completion.
        // Wait for that short acknowledgement window before removing its job.
        if (await job.isActive()) {
          if (Date.now() >= deadline) throw new Error('Queue cleanup unconfirmed');
          await new Promise(resolve => setTimeout(resolve, 100)); continue;
        }
        await job.remove(); break;
      }
    }
  } finally { client.disconnect(); if (queue) void queue.close().catch(() => {}); }
}

/** One disposable, nonblocking BullMQ producer per delivery attempt.
 * BullMQ 6 permits finite retries on Queue connections (only Worker blocking
 * connections require null). CUIDs are valid custom IDs: no ':' or integer IDs.
 * The overall deadline also covers BullMQ readiness, INFO and Lua script setup.
 */
export async function deliverScanJob(data: ScanJobData): Promise<{ alreadyPresent: boolean }> {
  const client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", PRODUCER_REDIS_OPTIONS);
  client.on("error", () => {}); // Publisher logs only fixed, secret-free codes.
  let queue: Queue<ScanJobData> | undefined;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = async () => {
    await client.connect();
    if (disposed) throw new Error("Producer disposed");
    queue = new Queue<ScanJobData>(SCAN_QUEUE_NAME, { connection: client, defaultJobOptions: SCAN_JOB_OPTIONS });
    queue.on("error", () => {});
    const existing = await queue.getJob(data.scanRunId);
    if (existing) {
      if (existing.name !== "scan" || existing.data.scanRunId !== data.scanRunId || existing.data.targetId !== data.targetId || existing.data.type !== data.type) {
        throw new Error("Job identity mismatch");
      }
      return { alreadyPresent: true };
    }
    if (disposed) throw new Error("Producer disposed");
    await queue.add("scan", data, { jobId: data.scanRunId });
    return { alreadyPresent: false };
  };
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Producer deadline")), PRODUCER_DEADLINE_MS); }),
    ]);
  } finally {
    disposed = true;
    clearTimeout(timer);
    client.disconnect(); // Stops reconnects and any late/offline commands too.
    // The socket is already disposed. Do not let BullMQ readiness/cleanup extend
    // the HTTP deadline; close its local listeners when initialization settles.
    if (queue) void queue.close().catch(() => {});
  }
}

/** Locked jobs are retried next pass; running workers detect missing SQL rows. */
export async function collectOrphanScanJobs() {
  const client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', PRODUCER_REDIS_OPTIONS);
  client.on('error', () => {});
  let queue: Queue<ScanJobData> | undefined;
  try {
    await client.connect();
    queue = new Queue<ScanJobData>(SCAN_QUEUE_NAME, { connection: client });
    let offset = 0;
    while (true) {
      const jobs = await queue.getJobs(['active', 'wait', 'delayed', 'prioritized', 'waiting-children', 'completed', 'failed'], offset, offset + 99);
      if (!jobs.length) break;
      const runs = await prisma.scanRun.findMany({ where: { id: { in: jobs.map(job => job.data.scanRunId) } }, select: { id: true, targetId: true } });
      let retained = 0;
      for (const job of jobs) {
        if (runs.some(run => run.id === job.data.scanRunId && run.targetId === job.data.targetId)) { retained++; continue; }
        try {
          await job.remove();
          logger.info({ operation: 'resource-gc', resource: 'redis-job', jobId: job.id }, 'Orphan scan job deleted');
        } catch { retained++; logger.info({ operation: 'resource-gc', resource: 'redis-job', jobId: job.id }, 'Locked orphan job deferred until next collection'); }
      }
      offset += retained;
    }
  } finally { client.disconnect(); if (queue) void queue.close().catch(() => {}); }
}
