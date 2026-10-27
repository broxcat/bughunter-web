import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { dispatchSelect } from "./scanJobPublisher";

export type ScanRequest = { targetId: string; type: "RECON" | "HUNT"; approvedTechniques: string[]; approveBoundedTiming?: true };
export class ScanRequestConflict extends Error {}
export class ScanRequestNotFound extends Error {}
function requestHash(input: ScanRequest): string {
  return createHash("sha256").update(JSON.stringify({ targetId: input.targetId, type: input.type, approvedTechniques: [...new Set(input.approvedTechniques)].sort(), approveBoundedTiming: input.approveBoundedTiming === true })).digest("hex");
}
export async function findScanRequest(userId: string, key: string | null, input: ScanRequest) {
  if (!key) return null;
  const request = await prisma.scanRequestKey.findUnique({
    where: { userId_key: { userId, key } },
    include: { scanRun: { include: { jobOutbox: { select: dispatchSelect }, target: { select: { userId: true } } } } },
  });
  if (!request) return null;
  if (request.scanRun.target.userId !== userId) throw new ScanRequestNotFound();
  if (request.requestHash !== requestHash(input)) throw new ScanRequestConflict("Idempotency-Key already used with different scan parameters");
  const { target: _target, ...run } = request.scanRun;
  void _target;
  return run;
}
export async function createScanRequest(userId: string, input: ScanRequest, key: string | null) {
  try {
    const run = await prisma.$transaction(async tx => {
      const run = await tx.scanRun.create({ data: { targetId: input.targetId, type: input.type, status: "QUEUED", approvedHuntTechniques: input.approvedTechniques } });
      const jobOutbox = await tx.scanJobOutbox.create({ data: { scanRunId: run.id }, select: dispatchSelect });
      if (key) await tx.scanRequestKey.create({ data: { userId, key, scanRunId: run.id, requestHash: requestHash(input) } });
      return { ...run, jobOutbox };
    });
    logger.info({ scanRunId: run.id, targetId: run.targetId, attempts: 0 }, "scan run and publication outbox created atomically");
    return run;
  } catch (error) {
    // A concurrent identical request won the UNIQUE(userId,key) constraint.
    // The losing transaction (including its ScanRun/outbox) was rolled back.
    if (key && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await findScanRequest(userId, key, input);
      if (existing) return existing;
    }
    throw error;
  }
}
