// The scan worker — a standalone process entrypoint (`npm run worker` →
// `tsx src/server/queue/worker.ts`). It creates a single BullMQ Worker at module
// load and processes scan jobs one at a time.
//
// SECURITY INVARIANT (the last gate): a scope can be revoked between enqueue and
// execution, so immediately before any tool is spawned the worker RE-VERIFIES
// that the target's Scope is APPROVED. If it is not, the ScanRun is marked FAILED
// and nothing is run. This is the final authorization attestation.
//
// concurrency: 1 — scans are heavy and have real side effects; never two at once.

import { Worker, type Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { redis } from "./connection";
import { SCAN_QUEUE_NAME, type ScanJobData } from "./scanQueue";
import { runRecon } from "@/server/scanners/recon";
import { runHunt } from "@/server/scanners/hunt";

async function processScan(job: Job<ScanJobData>): Promise<void> {
  const { scanRunId, type } = job.data;

  const scanRun = await prisma.scanRun.findUnique({
    where: { id: scanRunId },
    include: { target: { include: { scope: true } } },
  });

  if (!scanRun) {
    // Nothing to update — the run was deleted. Fail the job loudly.
    throw new Error(`ScanRun ${scanRunId} not found`);
  }

  const target = scanRun.target;
  const scope = target?.scope;

  // --- The final authorization gate. Re-checked here, not trusted from enqueue.
  if (!scope || scope.status !== "APPROVED") {
    await prisma.scanRun.update({
      where: { id: scanRunId },
      data: {
        status: "FAILED",
        error: `Scope not APPROVED (status: ${scope?.status ?? "MISSING"}) — refusing to scan ${target?.host ?? "unknown host"}`,
        finishedAt: new Date(),
      },
    });
    return; // Run NOTHING.
  }

  await prisma.scanRun.update({
    where: { id: scanRunId },
    data: { status: "RUNNING", startedAt: new Date(), error: null },
  });

  try {
    switch (type) {
      case "RECON":
        await runRecon(target.host, scanRunId);
        break;
      case "HUNT":
        await runHunt(target.host, scanRunId);
        break;
      case "VALIDATE":
        // Validate engine is ported in Phase 2; nothing to run yet.
        await prisma.scanLog.create({
          data: {
            scanRunId,
            line: "[worker] VALIDATE scan type is not yet implemented (Phase 2).",
            stream: "STDERR",
          },
        });
        break;
      default: {
        const exhaustive: never = type;
        throw new Error(`Unknown scan type: ${String(exhaustive)}`);
      }
    }

    await prisma.scanRun.update({
      where: { id: scanRunId },
      data: { status: "COMPLETED", finishedAt: new Date() },
    });
  } catch (err) {
    await prisma.scanRun.update({
      where: { id: scanRunId },
      data: {
        status: "FAILED",
        error: err instanceof Error ? err.message : String(err),
        finishedAt: new Date(),
      },
    });
    throw err; // Let BullMQ record the job failure too.
  }
}

const worker = new Worker<ScanJobData>(SCAN_QUEUE_NAME, processScan, {
  connection: redis,
  concurrency: 1,
});

worker.on("failed", (job, err) => {
  console.error(`[worker] job ${job?.id} failed:`, err?.message ?? err);
});

worker.on("ready", () => {
  console.log(`[worker] ready — processing "${SCAN_QUEUE_NAME}" (concurrency 1)`);
});

async function shutdown(signal: string) {
  console.log(`[worker] ${signal} received, closing...`);
  await worker.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

export { worker };
