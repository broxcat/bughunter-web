import { prisma } from "@/lib/prisma";
import { createHuntPolicySnapshot, huntPolicySnapshotSchema } from "@/lib/hunt/policy";
import type { TargetExecution } from "@/server/execution";

/** Write once at execution start. Retries use the original plan, never new policy. */
export async function startHuntSnapshot(scanRunId: string, execution: TargetExecution) {
  const where = { id: scanRunId, targetId: execution.targetId, type: "HUNT" as const };
  const run = await prisma.scanRun.findFirst({ where });
  if (!run) throw new Error("Hunt run does not belong to the selected host");
  if (run.huntSnapshot !== null) return huntPolicySnapshotSchema.parse(run.huntSnapshot);
  const snapshot = createHuntPolicySnapshot(execution);
  // SQL NULL, not JSON null. The predicate prevents concurrent/retried writes.
  const { Prisma } = await import("@prisma/client");
  await prisma.scanRun.updateMany({ where: { ...where, huntSnapshot: { equals: Prisma.DbNull } }, data: { huntSnapshot: snapshot } });
  return huntPolicySnapshotSchema.parse((await prisma.scanRun.findFirstOrThrow({ where })).huntSnapshot);
}
