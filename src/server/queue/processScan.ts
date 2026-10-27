import type { Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { loadTargetExecution, withTargetExecution } from "@/server/execution";
import { runRecon } from "@/server/scanners/recon";
import { runHunt } from "@/server/scanners/hunt";
import { logLine } from "@/server/scanners/context";
import type { ScanExecutionResult } from "@/server/scanners/result";
import type { ScanJobData } from "./scanQueue";

/** Final authorization gate; queue jobs never gain authorization from enqueue time. */
export async function processScan(job: Job<ScanJobData>): Promise<void> {
  const { scanRunId, type, targetId } = job.data;
  const scanRun = await prisma.scanRun.findUnique({
    where: { id: scanRunId },
    include: { target: { include: { scope: true } } },
  });
  if (!scanRun) throw new Error(`ScanRun ${scanRunId} not found`);
  // Never rewrite historical terminal results.
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(scanRun.status)) return;

  const finish = async (result: ScanExecutionResult) => {
    await prisma.scanRun.update({
      where: { id: scanRunId },
      data: {
        status: result.outcome === "FAILED" || result.outcome === "UNSUPPORTED" ? "FAILED" : "COMPLETED",
        outcome: result.outcome,
        error: result.reason ?? null,
        finishedAt: new Date(),
      },
    });
  };
  if (type === "VALIDATE" || scanRun.type === "VALIDATE") {
    const reason = "VALIDATE scan type is not supported: the validation engine is not implemented.";
    await logLine(scanRunId, `[worker] UNSUPPORTED: ${reason}`, "STDERR");
    await finish({ outcome: "UNSUPPORTED", reason });
    return;
  }
  // A stalled active Recon/Hunt is not safe to replay. VALIDATE above runs no tools.
  if (scanRun.status !== "QUEUED") return;
  const target = scanRun.target;
  const scope = target?.scope;
  if (!scope || scope.status !== "APPROVED") {
    await finish({ outcome: "FAILED", reason: `Scope not APPROVED (status: ${scope?.status ?? "MISSING"}) — refusing to scan` });
    return;
  }
  try {
    if (type !== scanRun.type || targetId !== target.id) throw new Error("Scan job does not match the stored target/type");
    const execution = await loadTargetExecution(target.id);
    const claimed = await prisma.scanRun.updateMany({
      where: { id: scanRunId, status: "QUEUED" },
      data: { status: "RUNNING", outcome: null, startedAt: new Date(), finishedAt: null, error: null, requiredUserAgent: execution.requiredUserAgent },
    });
    if (claimed.count !== 1) return; // Another worker won; never replay network execution.
    const result = await withTargetExecution(execution, async () => {
      switch (type) {
        case "RECON": return runRecon(target.host, scanRunId);
        case "HUNT": return runHunt(target.host, scanRunId);
        default: {
          const exhaustive: never = type;
          throw new Error(`Unknown scan type: ${String(exhaustive)}`);
        }
      }
    });
    await finish(result);
  } catch (err) {
    await finish({ outcome: "FAILED", reason: err instanceof Error ? err.message : "Scan execution failed" });
    throw err; // BullMQ records the failure; attempts remains 1 (no active scan retries).
  }
}
