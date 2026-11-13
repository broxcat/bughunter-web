import type { Prisma, TargetCampaign } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { admitTargetRecon, lockCampaignCapacity, lockReconProgram } from './recon/targetRuns';
import { lockOwnedProgram } from './scopeAssets';
import { ResearchError } from './research/workspace';

const live = ['QUEUED', 'RUNNING'] as const;
const attempts = 3;
const retryDelay = (attempt: number) => Math.min(15, 2 ** Math.max(0, attempt - 1)) * 60_000;
export const campaignDueAt = (minutes: number | null, now: Date) => minutes ? new Date(+now + minutes * 60_000) : null;

function parallelLimit() {
  const limit = Number(process.env.TARGET_CAMPAIGN_MAX_ACTIVE ?? 3);
  return Number.isInteger(limit) && limit >= 1 && limit <= 100 ? limit : 3;
}

export async function cancelCampaignScans(tx: Prisma.TransactionClient, ownerId: string, programId: string, queuedOnly: boolean) {
  await tx.scanRun.updateMany({ where: {
    target: { programId, userId: ownerId }, type: 'RECON', cancelRequestedAt: null,
    status: { in: queuedOnly ? ['QUEUED'] : [...live] },
  }, data: { cancelRequestedAt: new Date() } });
}

export async function changeCampaign(ownerId: string, programId: string, action: 'start' | 'pause' | 'resume' | 'handoff', beforeCommit?: (state: string) => void) {
  return prisma.$transaction(async tx => {
    await lockOwnedProgram(tx, ownerId, programId);
    const current = await tx.targetCampaign.findUnique({ where: { programId } });
    const now = new Date();
    const update = async (data: Prisma.TargetCampaignUpdateInput) => {
      const row = await tx.targetCampaign.update({ where: { programId }, data });
      beforeCommit?.(row.state);
    };
    if (!current) {
      if (action !== 'start') throw new ResearchError('Campaign has not been started', 409);
      const row = await tx.targetCampaign.create({ data: { programId, state: 'READY', reason: null, requestedAt: now } });
      beforeCommit?.(row.state);
      return;
    }
    if (action === 'pause') {
      if (current.state === 'PAUSED') return;
      await cancelCampaignScans(tx, ownerId, programId, true);
      await update({ state: 'PAUSED', requestedAt: null, retryAt: null, nextCycleAt: null, reason: null,
        continuing: current.state === 'RECON_RUNNING' || current.continuing });
      return;
    }
    if (action === 'handoff') {
      if (current.state === 'MONITORING') return;
      if (current.state !== 'RESEARCH_PENDING') throw new ResearchError('Research handoff is not ready', 409);
      await update({ state: 'MONITORING', nextCycleAt: campaignDueAt(current.intervalMinutes, now) });
      return;
    }
    if (current.state === 'RECON_RUNNING' || (current.state === 'READY' && current.requestedAt)) return;
    if (current.state === 'PAUSED' && action !== 'resume') throw new ResearchError('Resume the paused campaign first', 409);
    const continuing = action === 'resume' && current.continuing;
    await update({ state: 'READY', requestedAt: now, retryAt: null, nextCycleAt: null, reason: null, continuing });
  });
}

type TickOptions = { now?: Date; beforeCommit?: (state: string) => void };

/** The campaign transition, immutable parent membership, children and outbox
 * commit together. Redis delivery remains the existing outbox dispatcher's job. */
export async function advanceCampaign(ownerId: string, programId: string, options: TickOptions = {}) {
  const now = options.now ?? new Date();
  return prisma.$transaction(async tx => {
    await lockCampaignCapacity(tx);
    await lockReconProgram(tx, ownerId, programId);
    const row = await tx.targetCampaign.findUnique({ where: { programId } });
    if (!row || row.state === 'PAUSED') return;
    const save = async (data: Prisma.TargetCampaignUpdateInput) => {
      const changed = await tx.targetCampaign.update({ where: { programId }, data });
      options.beforeCommit?.(changed.state);
      return changed;
    };
    const recon = row.reconRunId ? await tx.targetReconRun.findFirst({ where: { id: row.reconRunId, programId },
      select: { id: true, status: true, outcome: true, finishedAt: true, scopeMarkdown: true, preflight: true } }) : null;
    if (row.state === 'RECON_RUNNING') {
      if (recon && live.some(status => status === recon.status)) {
        const preflight = recon.preflight as Prisma.JsonObject | null;
        if (preflight?.queue !== 'AVAILABLE' && !await tx.scanJobOutbox.count({ where: { status: 'PENDING', scanRun: { targetReconRunId: recon.id } } })) {
          await tx.targetReconRun.update({ where: { id: recon.id }, data: { preflight: { ...preflight, queue: 'AVAILABLE' } } });
        }
        return;
      }
      if (recon?.status === 'COMPLETED' && ['SUCCESS', 'PARTIAL'].includes(recon.outcome ?? '')) {
        if (recon.scopeMarkdown) return save({ state: 'RESEARCH_PENDING', handoffRunId: recon.id, reason: null, continuing: false });
        if (!recon.finishedAt || +now - +recon.finishedAt < 60_000) return;
      }
      return save({ state: 'FAILED', continuing: true, reason: recon?.status === 'CANCELLED'
        ? 'Recon was cancelled.' : recon?.status === 'COMPLETED' ? 'Recon did not produce a Research handoff.' : 'Recon failed without usable results.',
        retryAt: row.attempt < attempts ? new Date(+now + retryDelay(row.attempt)) : null });
    }
    const due = (row.state === 'READY' && row.requestedAt && row.requestedAt <= now)
      || (row.state === 'MONITORING' && row.nextCycleAt && row.nextCycleAt <= now)
      || (row.state === 'FAILED' && row.retryAt && row.retryAt <= now);
    if (!due || (recon && live.some(status => status === recon.status))) return;
    const alreadyActive = await tx.targetReconRun.findFirst({ where: { programId, status: { in: [...live] } }, select: { id: true } });
    if (alreadyActive) return;
    if (await tx.targetReconRun.count({ where: { campaignKey: { not: null }, status: { in: [...live] } } }) >= parallelLimit()) return;
    const cycle = row.continuing ? Math.max(1, row.cycle) : row.cycle + 1;
    const attempt = row.continuing ? row.attempt + 1 : 1;
    let parent;
    try { parent = await admitTargetRecon(tx, ownerId, programId, programId + ':' + cycle + ':' + attempt + ':recon'); }
    catch (error) {
      if (!(error instanceof ResearchError)) throw error;
      if (error.status === 409 || error.status === 429) {
        return save({ state: 'FAILED', reason: error.message, cycle, attempt, continuing: true, requestedAt: null, nextCycleAt: null,
          retryAt: attempt < attempts ? new Date(+now + retryDelay(attempt)) : null });
      }
      return save({ state: 'BLOCKED', reason: error.message, requestedAt: null, nextCycleAt: null, retryAt: null });
    }
    if (!parent) {
      if (row.continuing && recon?.status === 'COMPLETED' && recon.scopeMarkdown && row.handoffRunId !== recon.id) {
        return save({ state: 'RESEARCH_PENDING', handoffRunId: recon.id, cycle, attempt, requestedAt: null, retryAt: null, continuing: false, reason: null });
      }
      return save({ state: 'MONITORING', cycle, attempt, requestedAt: null, retryAt: null, continuing: false,
        nextCycleAt: campaignDueAt(row.intervalMinutes, now), reason: 'No new or modified assets in the current scope.' });
    }
    return save({ state: 'RECON_RUNNING', cycle, attempt, reconRunId: parent.id, continuing: false,
      requestedAt: null, retryAt: null, nextCycleAt: null, reason: null });
  }, { timeout: 30000 });
}

export function campaignAfterReview(row: TargetCampaign, intervalMinutes: number | null, now = new Date()): Prisma.TargetCampaignUpdateInput {
  const common = { intervalMinutes };
  // Rows blocked by the former policy gate recover on the next review.
  if (row.state === 'BLOCKED') return { ...common, state: 'READY', reason: null, requestedAt: now, nextCycleAt: null };
  if (row.state === 'MONITORING') return { ...common, nextCycleAt: campaignDueAt(intervalMinutes, now) };
  return common;
}
