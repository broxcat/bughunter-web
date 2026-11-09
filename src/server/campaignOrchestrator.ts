import type { Prisma, TargetCampaign } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { storedExecutionPolicySchema } from '@/lib/programExecutionPolicy';
import { programPolicyBlocker, programPolicyInclude, type PolicyProgram } from './programExecutionPolicy';
import { admitTargetRecon, lockCampaignCapacity, lockReconProgram } from './recon/targetRuns';
import { lockOwnedProgram } from './scopeAssets';
import { ResearchError } from './research/workspace';
import { campaignResearchJobs, queueCampaignResearch } from './research/campaignJobs';

const live = ['QUEUED', 'RUNNING'] as const;
const attempts = 3;
const retryDelay = (attempt: number) => Math.min(15, 2 ** Math.max(0, attempt - 1)) * 60_000;
export const campaignDueAt = (minutes: number | null, now: Date) => minutes ? new Date(+now + minutes * 60_000) : null;

function parallelLimit() {
  const limit = Number(process.env.TARGET_CAMPAIGN_MAX_ACTIVE ?? 3);
  return Number.isInteger(limit) && limit >= 1 && limit <= 100 ? limit : 3;
}

export function campaignPolicyBlocker(program: PolicyProgram) {
  const blocker = programPolicyBlocker(program);
  if (blocker) return blocker;
  const policy = storedExecutionPolicySchema.safeParse(program.executionPolicies?.[0]?.policy);
  return policy.success && policy.data.automationAllowed ? null : 'Confirm an execution policy that allows automation in Target settings.';
}

export async function cancelCampaignScans(tx: Prisma.TransactionClient, ownerId: string, programId: string, queuedOnly: boolean) {
  await tx.scanRun.updateMany({ where: {
    target: { programId, userId: ownerId }, type: { in: ['RECON', 'RESEARCH'] }, cancelRequestedAt: null,
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
      const program = await tx.bountyProgram.findUniqueOrThrow({ where: { id: programId }, include: programPolicyInclude });
      const blocker = campaignPolicyBlocker(program);
      const row = await tx.targetCampaign.create({ data: { programId, state: blocker ? 'BLOCKED' : 'READY',
        reason: blocker, requestedAt: blocker ? null : now } });
      beforeCommit?.(row.state);
      return;
    }
    if (action === 'pause') {
      if (current.state === 'PAUSED') return;
      await cancelCampaignScans(tx, ownerId, programId, true);
      await update({ state: 'PAUSED', requestedAt: null, retryAt: null, nextCycleAt: null, reason: null,
        continuing: ['RECON_RUNNING', 'RESEARCH_PENDING', 'RESEARCH_RUNNING'].includes(current.state) || current.continuing });
      return;
    }
    if (action === 'handoff') {
      // Compatibility for tabs opened before automated Research shipped.
      return;
    }
    if (['RECON_RUNNING', 'RESEARCH_PENDING', 'RESEARCH_RUNNING'].includes(current.state) ||
        (current.state === 'READY' && current.requestedAt)) return;
    if (current.state === 'PAUSED' && action !== 'resume') throw new ResearchError('Resume the paused campaign first', 409);
    const program = await tx.bountyProgram.findUniqueOrThrow({ where: { id: programId }, include: programPolicyInclude });
    const blocker = campaignPolicyBlocker(program);
    if (blocker) throw new ResearchError(blocker, 409);
    const continuing = action === 'resume' && current.continuing;
    const resumeResearch = continuing && current.handoffRunId && current.handoffRunId === current.reconRunId;
    await update({ state: resumeResearch ? 'RESEARCH_PENDING' : 'READY', requestedAt: resumeResearch ? null : now,
      retryAt: null, nextCycleAt: null, reason: null, continuing });
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
    const program = await tx.bountyProgram.findUniqueOrThrow({ where: { id: programId }, include: programPolicyInclude });
    const blocker = campaignPolicyBlocker(program);
    const save = async (data: Prisma.TargetCampaignUpdateInput) => {
      const changed = await tx.targetCampaign.update({ where: { programId }, data });
      options.beforeCommit?.(changed.state);
      return changed;
    };
    if (blocker) {
      if (row.state === 'BLOCKED' && row.reason === blocker) return;
      await cancelCampaignScans(tx, ownerId, programId, false);
      return save({ state: 'BLOCKED', reason: blocker, requestedAt: null, retryAt: null, nextCycleAt: null, continuing: false });
    }
    const recon = row.reconRunId ? await tx.targetReconRun.findFirst({ where: { id: row.reconRunId, programId },
      select: { id: true, status: true, outcome: true, preflight: true } }) : null;
    if (row.state === 'RECON_RUNNING') {
      if (recon && live.some(status => status === recon.status)) {
        const preflight = recon.preflight as Prisma.JsonObject | null;
        if (preflight?.queue !== 'AVAILABLE' && !await tx.scanJobOutbox.count({ where: { status: 'PENDING', scanRun: { targetReconRunId: recon.id } } })) {
          await tx.targetReconRun.update({ where: { id: recon.id }, data: { preflight: { ...preflight, queue: 'AVAILABLE' } } });
        }
        return;
      }
      if (recon?.status === 'COMPLETED' && ['SUCCESS', 'PARTIAL'].includes(recon.outcome ?? '')) {
        return save({ state: 'RESEARCH_PENDING', handoffRunId: recon.id, reason: null, continuing: false });
      }
      return save({ state: 'FAILED', continuing: true, reason: recon?.status === 'CANCELLED'
        ? 'Recon was cancelled.' : 'Recon failed without usable results.',
        retryAt: row.attempt < attempts ? new Date(+now + retryDelay(row.attempt)) : null });
    }
    if (row.state === 'RESEARCH_PENDING' || row.state === 'RESEARCH_RUNNING') {
      const handoffId = row.handoffRunId;
      if (!handoffId) return save({ state: 'FAILED', reason: 'The Research source Recon run is missing.', continuing: false });
      if (row.state === 'RESEARCH_PENDING') {
        const { jobs, queued } = await queueCampaignResearch(tx, programId, ownerId, handoffId);
        // Pause may have requested cancellation before the dispatcher settled it.
        if (!queued && jobs.some(job => job.status === 'QUEUED' && job.cancelRequestedAt)) return;
        if (queued || jobs.length) return save({ state: 'RESEARCH_RUNNING', continuing: false, reason: null });
        return save({ state: 'MONITORING', continuing: false, reason: 'No eligible Recon assets remain for Research.',
          nextCycleAt: campaignDueAt(row.intervalMinutes, now) });
      }
      const jobs = await campaignResearchJobs(tx, programId, handoffId);
      if (jobs.some(job => live.some(status => status === job.status))) return;
      if (jobs.some(job => job.status === 'FAILED')) return save({ state: 'FAILED', continuing: false,
        reason: 'A Research job failed or was interrupted. Open Research to review the results and execution history.' });
      return save({ state: 'MONITORING', continuing: false, reason: null, nextCycleAt: campaignDueAt(row.intervalMinutes, now) });
    }
    const due = (row.state === 'READY' && row.requestedAt && row.requestedAt <= now)
      || (row.state === 'MONITORING' && row.nextCycleAt && row.nextCycleAt <= now)
      || (row.state === 'FAILED' && row.retryAt && row.retryAt <= now);
    if (!due || (recon && live.some(status => status === recon.status))) return;
    const alreadyActive = await tx.targetReconRun.findFirst({ where: { programId, status: { in: [...live] } }, select: { id: true } });
    if (alreadyActive || await tx.scanRun.findFirst({ where: { type: 'RESEARCH', status: { in: [...live] },
      target: { programId, userId: ownerId } }, select: { id: true } })) return;
    const activeCampaigns = await tx.targetCampaign.count({ where: { OR: [
      { state: { in: ['RECON_RUNNING', 'RESEARCH_PENDING', 'RESEARCH_RUNNING'] } },
      { program: { targets: { some: { scanRuns: { some: {
        status: 'RUNNING', OR: [{ targetReconRun: { campaignKey: { not: null } } }, { type: 'RESEARCH' }],
      } } } } } },
    ] } });
    if (activeCampaigns >= parallelLimit()) return;
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
      if (row.continuing && recon?.status === 'COMPLETED' && ['SUCCESS', 'PARTIAL'].includes(recon.outcome ?? '') && row.handoffRunId !== recon.id) {
        return save({ state: 'RESEARCH_PENDING', handoffRunId: recon.id, cycle, attempt, requestedAt: null, retryAt: null, continuing: false, reason: null });
      }
      return save({ state: 'MONITORING', cycle, attempt, requestedAt: null, retryAt: null, continuing: false,
        nextCycleAt: campaignDueAt(row.intervalMinutes, now), reason: 'No new or modified assets in the current scope.' });
    }
    return save({ state: 'RECON_RUNNING', cycle, attempt, reconRunId: parent.id, continuing: false,
      requestedAt: null, retryAt: null, nextCycleAt: null, reason: null });
  }, { timeout: 30000 });
}

export function campaignAfterReview(row: TargetCampaign, blocker: string | null, intervalMinutes: number | null, now = new Date()): Prisma.TargetCampaignUpdateInput {
  const common = { intervalMinutes };
  if (blocker && row.state !== 'PAUSED') return { ...common, state: 'BLOCKED', reason: blocker, requestedAt: null, retryAt: null, nextCycleAt: null };
  if (row.state === 'BLOCKED') {
    const resumeResearch = row.handoffRunId && row.handoffRunId === row.reconRunId;
    return { ...common, state: resumeResearch ? 'RESEARCH_PENDING' : 'READY', reason: null,
      requestedAt: resumeResearch ? null : now, nextCycleAt: null };
  }
  if (row.state === 'MONITORING') return { ...common, nextCycleAt: campaignDueAt(intervalMinutes, now) };
  return common;
}
