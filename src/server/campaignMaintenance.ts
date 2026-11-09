import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { advanceCampaign } from './campaignOrchestrator';
import { CAMPAIGN_SYNC_INTERVAL, resyncCampaign } from './campaignResync';

const select = { programId: true, program: { select: { ownerId: true } } } as const;
const hosted = ['HACKERONE', 'BUGCROWD', 'INTIGRITI', 'YESWEHACK'] as const;

export async function maintainTargetCampaigns(now = new Date()) {
  const expiredSync = new Date(+now - CAMPAIGN_SYNC_INTERVAL);
  const due = await prisma.targetCampaign.findMany({ where: {
    program: { deletingAt: null },
    OR: [
      { state: { in: ['RECON_RUNNING', 'RESEARCH_PENDING', 'RESEARCH_RUNNING'] } },
      { state: 'READY', requestedAt: { lte: now } },
      { state: 'MONITORING', nextCycleAt: { lte: now } },
      { state: 'FAILED', retryAt: { lte: now } },
    ],
  }, orderBy: [{ updatedAt: 'asc' }, { programId: 'asc' }], take: 32, select });
  const sync = await prisma.targetCampaign.findFirst({ where: {
    state: { notIn: ['PAUSED', 'BLOCKED'] },
    program: { deletingAt: null, platform: { in: [...hosted] }, programUrl: { not: null } },
    OR: [{ lastSyncAt: null }, { lastSyncAt: { lte: expiredSync } }],
  }, orderBy: [{ lastSyncAt: { sort: 'asc', nulls: 'first' } }, { programId: 'asc' }], select });
  const advance = async (item: (typeof due)[number]) => {
    const { programId, program: { ownerId } } = item;
    try { await advanceCampaign(ownerId, programId, { now }); }
    catch { logger.warn({ programId }, 'Target campaign reconciliation will retry'); }
  };
  // Keep platform latency outside Recon admission transactions and off the
  // execution heartbeat. Each sync claim is serialized per Target.
  const syncWork = sync && (async () => {
    try { await resyncCampaign(sync.program.ownerId, sync.programId, now); }
    catch { logger.warn({ programId: sync.programId }, 'Target scope resync unavailable'); }
    await advance(sync);
  })();
  for (const item of due) if (item.programId !== sync?.programId) await advance(item);
  await syncWork;
}

export function startCampaignMaintenance() {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  let work: Promise<void>;
  async function tick() {
    try { await maintainTargetCampaigns(); }
    catch { logger.warn('Target campaign maintenance will retry'); }
    finally { if (!stopped) timer = setTimeout(() => { work = tick(); }, 3000); }
  }
  work = tick();
  return { async close() { stopped = true; clearTimeout(timer); await work; } };
}
