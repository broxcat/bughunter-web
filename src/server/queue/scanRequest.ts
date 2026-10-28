import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { dispatchSelect } from "./scanJobPublisher";
import { RATE_LIMIT_POLICIES } from "@/lib/abusePolicy";

// Empty legacy hashing fields preserve existing Recon idempotency keys; approvals cannot execute.
export type ScanRequest = { targetId: string; type: "RECON"; approvedTechniques?: string[]; approveBoundedTiming?: true };
export class ScanRequestConflict extends Error {}
export class ScanRequestNotFound extends Error {}
export class ScanRequestQuotaExceeded extends Error {
  constructor(public readonly retrySec: number) { super("Too many scan runs. Please try again later."); }
}
function requestHash(input: ScanRequest): string {
  return createHash("sha256").update(JSON.stringify({ targetId: input.targetId, type: input.type, approvedTechniques: [...new Set(input.approvedTechniques ?? [])].sort(), approveBoundedTiming: input.approveBoundedTiming === true })).digest("hex");
}
export async function findScanRequest(userId: string, key: string | null, input: ScanRequest, db: Pick<Prisma.TransactionClient, "scanRequestKey"> = prisma) {
  if (!key) return null;
  const request = await db.scanRequestKey.findUnique({
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
export async function createScanRequest(userId: string, input: ScanRequest, key: string | null, reuseLive = false) {
  if (input.type !== "RECON" || input.approvedTechniques?.length || input.approveBoundedTiming) throw new ScanRequestConflict("Only Recon scans are supported; legacy Hunt is retired");
  try {
    const run = await prisma.$transaction(async tx => {
      // PostgreSQL is the durable quota authority, including during Redis loss.
      // Serialize creation per user across web instances. Replays do not spend
      // another slot, including concurrent requests at the quota boundary.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const existing = await findScanRequest(userId, key, input, tx);
      if (existing) return existing;
      if (reuseLive) {
        const live = await tx.scanRun.findFirst({ where: { targetId: input.targetId, target: { userId }, type: 'RECON', status: { in: ['QUEUED', 'RUNNING'] } }, include: { jobOutbox: { select: dispatchSelect } } });
        if (live) return live;
      }
      const policy = RATE_LIMIT_POLICIES.scanUser;
      const where = { target: { userId }, createdAt: { gt: new Date(Date.now() - policy.windowSec * 1000) } };
      if (await tx.scanRun.count({ where }) >= policy.limit) {
        const oldest = await tx.scanRun.findFirst({ where, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
        throw new ScanRequestQuotaExceeded(Math.max(1, Math.ceil(((oldest?.createdAt.getTime() ?? Date.now()) + policy.windowSec * 1000 - Date.now()) / 1000)));
      }
      const run = await tx.scanRun.create({ data: { targetId: input.targetId, type: input.type, status: "QUEUED" } });
      const jobOutbox = await tx.scanJobOutbox.create({ data: { scanRunId: run.id }, select: dispatchSelect });
      if (key) await tx.scanRequestKey.create({ data: { userId, key, scanRunId: run.id, requestHash: requestHash(input) } });
      return { ...run, jobOutbox };
    });
    logger.info({ scanRunId: run.id, targetId: run.targetId, attempts: 0 }, "durable scan request accepted with publication outbox");
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
