import { constants } from 'node:fs';
import { open, readdir, rm, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { issueCollectorTicket, issueStopTicket, targetIdentity } from '@/lib/research/terminal';
import { deleteProgram } from './programDeletion';
import { consoleRoot } from './research/consoleWorkspace';
import { researchRoot } from './research/sessions';
import { readTerminalSigningKey } from './research/terminalKey';
import { publicationRoot, withPublicationLock } from './research/publicationLock';
import { collectOrphanScanJobs } from './queue/scanQueue';

export const RESOURCE_COLLECTION_INTERVAL_MS = 5 * 60 * 1000;
const uuid = '[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}';
const workspaceIdentity = new RegExp(`^(research_[A-Za-z0-9][A-Za-z0-9_-]{0,99}|${uuid})$`, 'i');
function workspaceFromEntry(name: string) {
  let identity = name.replace(/\.zip$/, '');
  if (identity.startsWith('.tmp-')) identity = identity.slice(5).replace(new RegExp(`-${uuid}$`, 'i'), '');
  return workspaceIdentity.exec(identity)?.[1];
}
const inventorySchema = z.array(z.object({ targetId: targetIdentity, workspaceId: z.string() })).max(10000);
const removed = (resource: string, identity: string) => logger.info({ operation: 'resource-gc', resource, identity }, 'Orphan resource deleted');
const deferred = (resource: string) => logger.warn({ operation: 'resource-gc', resource }, 'Resource cleanup deferred until next collection');

async function consoleRequest(path: string, token: string) {
  const response = await fetch(new URL(path, process.env.RESEARCH_TERMINAL_CONTROL_URL ?? 'http://research-console:7681'), {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Console cleanup unavailable');
  return response.json();
}
async function stopConsole(targetId: string, workspaceId: string) {
  const result = await consoleRequest('/control/stop', issueStopTicket(targetId, workspaceId, await readTerminalSigningKey()));
  if (result.stopped !== true) throw new Error('Console cleanup unconfirmed');
  removed('console', workspaceId);
}

async function entries(root: FileHandle, directory = '.') {
  try {
    const child = await open(`/proc/self/fd/${root.fd}/${directory}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { return await readdir(`/proc/self/fd/${child.fd}`); } finally { await child.close(); }
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

async function collectWorkspaces(root: string) {
  let directory: FileHandle;
  try { directory = await publicationRoot(root); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  try {
    const names = [...await entries(directory), ...await entries(directory, '.exports')];
    const ids = new Set(names.flatMap(name => workspaceFromEntry(name) ?? []));
    for (const workspaceId of ids) {
      try {
        // Reservations precede publication. Recheck under its lock so a collector
        // cannot race a publisher or remove a still-live workspace.
        await withPublicationLock(root, workspaceId, async () => {
          if (await prisma.researchSession.count({ where: { workspaceId } })) return;
          if (workspaceId.startsWith('research_')) {
            // Leave disk identity available for retry when the console is down.
            await stopConsole(workspaceId.slice('research_'.length), workspaceId);
          }
          const current = [...(await entries(directory)).map(name => ({ name, parent: '.' })),
            ...(await entries(directory, '.exports')).map(name => ({ name, parent: '.exports' }))];
          for (const entry of current) {
            if (workspaceFromEntry(entry.name) !== workspaceId) continue;
            // Open export parent with O_NOFOLLOW; rm never follows entry symlinks.
            const parent = await open(`/proc/self/fd/${directory.fd}/${entry.parent}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
            try { await rm(`/proc/self/fd/${parent.fd}/${entry.name}`, { recursive: true, force: true, maxRetries: 3 }); }
            finally { await parent.close(); }
            removed('workspace', join(root, entry.parent, entry.name));
          }
        });
      } catch { deferred('workspace ' + workspaceId); }
    }
  } finally { await directory.close(); }
}

/** Each resource family is independent: offline Research or Redis never prevents
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
    ['consoles', async () => {
      const inventory = inventorySchema.parse(await consoleRequest('/control/inventory', issueCollectorTicket(await readTerminalSigningKey())));
      for (const item of inventory) {
        try {
          if (!await prisma.researchSession.count({ where: { workspaceId: item.workspaceId, targetId: item.targetId } })) await stopConsole(item.targetId, item.workspaceId);
        } catch { deferred('console ' + item.workspaceId); }
      }
    }],
    ...[...new Set([consoleRoot(), researchRoot()])].map(root => ['workspaces', () => collectWorkspaces(root)] as [string, () => Promise<void>]),
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
