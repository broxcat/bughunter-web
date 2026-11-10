import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { researchRootFor } from "./sessions";
import { ResearchError } from "./workspace";
/** Mark retired authorization while retaining historical evidence files. */
export async function pauseAssetResearch(userId: string, assetId: string) {
  const sessions = await prisma.researchSession.findMany({
    where: {
      userId,
      target: {
        userId,
        OR: [{ scopeAssetId: assetId }, { discoveredFromAssetId: assetId }],
      },
    },
    select: { workspaceId: true, targetId: true },
  });
  if (!sessions.length) return;
  for (const session of sessions) {
    const root = researchRootFor(session.workspaceId);
    try {
      const directory = await open(
        join(root, session.workspaceId),
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      try {
        const marker = await open(
          `/proc/self/fd/${directory.fd}/.deleting`,
          constants.O_CREAT | constants.O_RDONLY | constants.O_NOFOLLOW,
          0o440,
        );
        try {
          const stat = await marker.stat();
          if (
            !stat.isFile() ||
            stat.nlink !== 1 ||
            stat.uid !== process.getuid!()
          )
            throw new ResearchError("Unsafe authorization marker", 409);
          await marker.chmod(0o440);
        } finally {
          await marker.close();
        }
      } finally {
        await directory.close();
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
}
