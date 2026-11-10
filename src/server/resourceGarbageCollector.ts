import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { deleteProgram } from './programDeletion';
import { collectOrphanScanJobs } from './queue/scanQueue';

export const RESOURCE_COLLECTION_INTERVAL_MS = 5 * 60 * 1000;
const removed = (resource: string, identity: string) => logger.info({ operation: 'resource-gc', resource, identity }, 'Orphan resource deleted');
const deferred = (resource: string) => logger.warn({ operation: 'resource-gc', resource }, 'Resource cleanup deferred until next collection');

/** Each resource family is independent: an unavailable Redis never prevents
 * tombstone finalization, SQL cleanup or the next scheduled attempt. */
export async function collectOrphanResources() {
  const retiring = await prisma.bountyProgram.findMany({ where: { deletingAt: { not: null } }, select: { id: true, ownerId: true } });
  for (const program of retiring) {
    try { await deleteProgram(program.ownerId, program.id); removed('retiring-target', program.id); }
    catch { deferred('retiring-target ' + program.id); }
  }
  const tasks: [string, () => Promise<unknown>][] = [
    ['reports', async () => {
      const count = await prisma.report.deleteMany({ where: { targetId: null, items: { none: {} } } });
      if (count.count) logger.info({ operation: 'resource-gc', resource: 'reports', count: count.count }, 'Empty reports deleted');
    }],
    ['oob-hits', async () => {
      const count = await prisma.$executeRaw`DELETE FROM "OobHit" h WHERE NOT EXISTS (SELECT 1 FROM "Finding" f WHERE f."oobToken"=h.token)`;
      if (count) logger.info({ operation: 'resource-gc', resource: 'oob-hits', count }, 'Orphan OOB hits deleted');
    }],
    ['redis-jobs', collectOrphanScanJobs],
  ];
  for (const [resource, task] of tasks) { try { await task(); } catch { deferred(resource); } }
}

export function startResourceGarbageCollector() {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  let work: Promise<void>;
  async function tick() {
    try { await collectOrphanResources(); }
    catch { deferred('collection'); }
    finally { if (!stopped) timer = setTimeout(() => { work = tick(); }, RESOURCE_COLLECTION_INTERVAL_MS); }
  }
  work = tick();
  return { async close() { stopped = true; clearTimeout(timer); await work; } };
}
