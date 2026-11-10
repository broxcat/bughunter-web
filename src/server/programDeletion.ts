import {
  readPublicationManifest,
  discardPublicationTemporary,
  discardPublicationArchive,
} from "./research/publicationFiles";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { targetIdentity, targetWorkspaceId } from "@/lib/research/identity";
import { ResearchError } from "./research/workspace";
import { researchRootFor } from "./research/sessions";
import { revokeWorkspace, removeWorkspace } from "./research/workspaceCleanup";
import { archivedConsoleRoot as consoleRoot } from "./research/sessions";
import {
  requestScanCancellation,
  settleQueuedCancellations,
} from "./queue/scanCancellation";
import { purgeScanJobs } from "./queue/scanQueue";

const PROGRAM_DELETION_STALE_MS = 5 * 60_000;

/** Deletion is synchronous. A tombstone older than this is abandoned state
 * left by a crash/deploy/older failed implementation and must not block a
 * Target forever. */
export async function recoverStaleProgramDeletions(userId: string, programId?: string, now = new Date()) {
  return prisma.bountyProgram.updateMany({
    where: {
      ownerId: userId,
      ...(programId ? { id: programId } : {}),
      deletingAt: { lt: new Date(now.getTime() - PROGRAM_DELETION_STALE_MS) },
    },
    data: { deletingAt: null },
  });
}

export async function deleteProgram(userId: string, programId: string) {
  targetIdentity.parse(programId);
  const deletionStartedAt = new Date();
  let marked = false;
  try {
    // Short-lived mutex only. It must never survive a failed synchronous delete.
    const exists = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "BountyProgram" WHERE id=${programId} AND "ownerId"=${userId} FOR UPDATE`;
      if (!rows.length) return false;
      await tx.bountyProgram.update({
        where: { id: programId },
        data: { deletingAt: deletionStartedAt },
      });
      return true;
    });
    if (!exists) return; // Idempotent; discloses no ownership information.
    marked = true;
    // Do not hold a transaction across worker cancellation. Every cleanup step is idempotent.
    const tx = prisma;
  const program = await tx.bountyProgram.findFirst({
    where: { id: programId, ownerId: userId },
  });
  if (!program) return;
  const targets = await tx.target.findMany({
    where: { programId },
    select: { id: true, scopeId: true, userId: true },
  });
  if (targets.some((t) => t.userId !== userId))
    throw new ResearchError("Program ownership is inconsistent", 409);
  const ids = targets.map((t) => t.id);
  const runs = await tx.scanRun.findMany({
    where: { targetId: { in: ids } },
    select: { id: true },
  });
  const sessions = await tx.researchSession.findMany({
    where: { targetId: { in: ids } },
    select: {
      id: true,
      publicationManifest: true,
      workspaceId: true,
      targetId: true,
    },
  });
  // Also recover a publication whose SQL transaction failed after filesystem
  // publication. Deterministic console paths belong only to this identity.
  for (const target of targets) {
    const workspaceId = targetWorkspaceId(target.id);
    if (sessions.some((s) => s.workspaceId === workspaceId)) continue;
    for (const name of [workspaceId, `.tmp-${workspaceId}`]) {
      const stat = await lstat(join(consoleRoot(), name)).catch((e) => {
        if (e.code !== "ENOENT") throw e;
        return null;
      });
      if (stat) {
        sessions.push({
          id: "",
          publicationManifest: null,
          workspaceId,
          targetId: target.id,
        });
        break;
      }
    }
  }
  await prisma.targetReconRun.updateMany({
    where: { programId, status: { in: ["QUEUED", "RUNNING"] } },
    data: { cancelRequestedAt: new Date() },
  });
  await prisma.reconSummary.updateMany({
    where: { programId, status: { in: ["PENDING", "RUNNING"] } },
    data: { status: "CANCELLED" },
  });
  for (const run of runs) await requestScanCancellation(run.id, userId);
  await settleQueuedCancellations();
  for (const session of sessions)
    await revokeWorkspace(
      researchRootFor(session.workspaceId),
      session.workspaceId,
    );
  const deadline = Date.now() + 15000;
  while (true) {
    await settleQueuedCancellations();
    const pending = await prisma.scanRun.count({
      where: {
        targetId: { in: ids },
        OR: [
          { status: { in: ["QUEUED", "RUNNING"] } },
          {
            executionAttempts: {
              some: {
                OR: [
                  { state: "RUNNING" },
                  { state: "INTERRUPTED", cleanupConfirmedAt: null },
                  { reason: "CLEANUP_UNCONFIRMED", cleanupConfirmedAt: null },
                ],
              },
            },
          },
        ],
      },
    });
    if (!pending) break;
    if (Date.now() >= deadline)
      throw new ResearchError(
        "Scan cleanup unconfirmed; retry deletion after the worker stops",
        503,
      );
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  // Redis job payloads/history also belong exclusively to these scans.
  await purgeScanJobs(runs.map((r) => r.id));
  for (const session of sessions) {
    if (session.publicationManifest) {
      const manifest = readPublicationManifest(session.publicationManifest);
      if (
        manifest.sessionId !== session.id ||
        manifest.workspaceId !== session.workspaceId ||
        manifest.targetId !== session.targetId
      )
        throw new ResearchError("Workspace reservation mismatch", 409);
      await discardPublicationTemporary(
        researchRootFor(session.workspaceId),
        manifest,
      );
      await discardPublicationArchive(
        researchRootFor(session.workspaceId),
        manifest,
      );
    }
    await removeWorkspace(
      researchRootFor(session.workspaceId),
      session.workspaceId,
    );
  }
  // Reports spanning other targets and OOB tokens shared with other findings
  // remain intact. Exclusive report content must not survive SET NULL FKs.
  await prisma.$transaction(
    async (tx) => {
      const present = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "BountyProgram" WHERE id=${programId} AND "ownerId"=${userId} FOR UPDATE`;
      if (!present.length) return;
      const ownedFinding = { targetId: { in: ids } };
      const tokens = await tx.finding.findMany({
        where: { ...ownedFinding, oobToken: { not: null } },
        select: { oobToken: true },
      });
      await tx.report.deleteMany({
        where: {
          userId,
          OR: [
            { targetId: { in: ids } },
            { items: { some: { finding: ownedFinding } } },
          ],
          NOT: { items: { some: { finding: { targetId: { notIn: ids } } } } },
        },
      });
      await tx.researchFindingPromotion.deleteMany({
        where: {
          OR: [
            { finding: ownedFinding },
            { hypothesis: { session: { targetId: { in: ids } } } },
          ],
        },
      });
      await tx.researchSession.deleteMany({ where: { targetId: { in: ids } } });
      await tx.target.deleteMany({ where: { id: { in: ids } } });
      for (const token of new Set(tokens.map((t) => t.oobToken!)))
        if (!(await tx.finding.count({ where: { oobToken: token } })))
          await tx.oobHit.deleteMany({ where: { token } });
      await tx.scope.deleteMany({
        where: {
          id: { in: targets.map((t) => t.scopeId) },
          userId,
          targets: { none: {} },
        },
      });
      await tx.bountyProgram.delete({ where: { id: programId } });
      logger.info(
        { operation: "program-delete", programId, userId },
        "Target resources removed after confirmed cleanup",
      );
    },
    { timeout: 15000 },
  );
  } catch (error) {
    // Release only the marker written by this exact attempt. A concurrent newer
    // deletion owns a different timestamp and cannot be accidentally reopened.
    if (marked) {
      try {
        await prisma.bountyProgram.updateMany({
          where: { id: programId, ownerId: userId, deletingAt: deletionStartedAt },
          data: { deletingAt: null },
        });
      } catch {
        logger.error(
          { operation: "program-delete-release", programId, userId, code: "TOMBSTONE_RELEASE_FAILED" },
          "Failed to release Target deletion tombstone",
        );
      }
    }
    throw error;
  }
}
