import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { matchesHost, isExcluded } from '@/lib/bountyProgram';
import { assetAllowsUrl, assetAllowsHost } from '@/lib/scopeAssets';
import { assertExecutionUrl } from '@/server/execution';
import { discoveryState } from '@/server/recon/program';
import type { ResearchProvider } from '@/lib/research/provider';
import type { ResearchReconContext, ReconPanelState } from '@/lib/research/recon';
import { issueReconDelivery } from '@/lib/research/reconDelivery';
import { assertResearchTarget, researchTargetSelect, researchAuthorizationSnapshot, researchIsPassive, ResearchError, type ResearchTarget } from './workspace';
import { buildReconContext, compactReconContext, reconHash, reconJson, RECON_INPUT_LIMITS, type ReconRun } from './reconContext';
import { ensureTargetConsole, consoleRoot } from './consoleWorkspace';
import { publishReconFiles } from './reconFiles';
import { readTerminalSigningKey } from './terminalKey';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { expandAssetReconRuns } from './reconInputs';
import { assetSelect, scopeAssetSourceIds } from '../scopeAssets';

const snapshotSelect = { id: true, sourceFingerprint: true, contentSha256: true, summarySha256: true, createdAt: true, summary: true } as const;
const deliverySelect = { id: true, snapshotId: true, provider: true, status: true, createdAt: true } as const;
async function loadInputs(tx: Prisma.TransactionClient, target: ResearchTarget) {
  const asset = target.scopeAsset ?? target.discoveredFromAsset;
  const sourceIds = asset ? await scopeAssetSourceIds(tx, asset) : [];
  const runs = await tx.scanRun.findMany({
    where: { type: 'RECON', target: { userId: target.userId, programId: target.program!.id },
      ...(asset ? { OR: [{ scopeAssetId: { in: sourceIds } }, { targetId: target.id }, { target: { discoveredFromAssetId: asset.id } }] }
        : target.contextOnly ? {} : { OR: [{ targetId: target.id }, { target: { contextOnly: true, scopeAssetId: null } }] }) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: RECON_INPUT_LIMITS.scans,
    select: { id: true, targetId: true, status: true, outcome: true, createdAt: true, startedAt: true, finishedAt: true, reconCorpus: true, assetResults: true, target: { select: { host: true } },
      discoveries: { take: RECON_INPUT_LIMITS.discoveries, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, host: true, source: true, state: true, createdAt: true } },
      _count: { select: { discoveries: true, logs: true } } },
  });
  const result: ReconRun[] = [];
  for (const run of runs) {
    // SQL bounds each line before transferring it. Raw output remains untouched in ScanLog.
    const logs = await tx.$queryRaw<ReconRun['logs']>`SELECT id, left(line, 16385) AS line, stream::text AS stream, "createdAt" FROM "ScanLog" WHERE "scanRunId" = ${run.id} ORDER BY "createdAt", id LIMIT ${RECON_INPUT_LIMITS.logs}`;
    result.push({ ...run, logs });
  }
  return result;
}
export function reconScopePolicy(target: ResearchTarget, scopeAssets: NonNullable<ResearchReconContext['scopeAssets']> = []) {
  // The repository supports structured host patterns, not structured path rules.
  // Keep ambiguous legacy prose visible; never infer active authorization from it.
  const manualReview = Boolean(target.scope.scopeDetails?.trim() || target.scope.outOfScope?.trim());
  return {
    activeSuggestionsAllowed: !researchIsPassive(target) && !manualReview,
    warnings: [
      ...(manualReview ? ['Legacy free-text scope restrictions require manual review; suggestions are passive only. Structured URL/path authorization is not available in the current scope engine.'] : []),
      ...(researchIsPassive(target) ? ['Program/wildcard console is passive only. Open an individually authorized host console before active investigation.'] : []),
    ],
    inScope(value: string) {
      try {
        const url = value.startsWith('http') ? new URL(value) : null;
        const host = url?.hostname ?? value;
        const boundary = target.scopeAsset ?? target.discoveredFromAsset;
        if (boundary) return boundary.active && (target.scopeAsset || host === target.host) && !isExcluded(host, target.program!.outOfScope) && (url ? assetAllowsUrl(boundary, value) : assetAllowsHost(boundary, host));
        if (target.contextOnly) {
          const legacyExclusions = target.scope.outOfScope?.toLowerCase().match(/(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+/g) ?? [];
          return target.scope.status === 'APPROVED' && !legacyExclusions.some(r => matchesHost(host, r)) && !isExcluded(host, target.program!.outOfScope) && (scopeAssets.length ? scopeAssets.some(a => a.active && (url ? assetAllowsUrl(a, value) : assetAllowsHost(a, host))) : discoveryState(host, target.program!.scopeRules, target.program!.outOfScope) === 'VALIDATED');
        }
        assertResearchTarget(target, target.userId);
        if (host !== target.host) return false;
        if (url) {
          assertExecutionUrl(value, { targetId: target.id, host: target.host, requiredUserAgent: target.program!.requiredUserAgent, qualifying: target.program!.qualifying, nonQualifying: target.program!.nonQualifying });
          // Persistent console's existing service restriction (ConsolePolicy).
          if (url.protocol !== `${target.scheme ?? 'https'}:` || Number(url.port || (url.protocol === 'https:' ? 443 : 80)) !== (target.scheme === 'http' ? 80 : 443)) return false;
        }
        return true;
      } catch { return false; }
    },
  };
}
async function ownedTarget(tx: Prisma.TransactionClient, userId: string, targetId: string, lock = false) {
  if (lock) await tx.$queryRaw`SELECT id FROM "Target" WHERE id=${targetId} AND "userId"=${userId} FOR UPDATE`;
  let target = await tx.target.findFirst({ where: { id: targetId, userId, program: { ownerId: userId } }, select: researchTargetSelect });
  if (!target) throw new ResearchError('Target not found', 404);
  if (lock) {
    await tx.$queryRaw`SELECT id FROM "Scope" WHERE id=${target.scope.id} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "BountyProgram" WHERE id=${target.program!.id} FOR SHARE`;
    target = await tx.target.findUniqueOrThrow({ where: { id: targetId }, select: researchTargetSelect });
  }
  assertResearchTarget(target, userId); return target;
}
function fingerprint(target: ResearchTarget, runs: ReconRun[], assets: unknown[]) {
  return reconHash(reconJson({ normalizerVersion: 2, limits: RECON_INPUT_LIMITS, policy: researchAuthorizationSnapshot(target), runs, assets }));
}
async function loadAssets(tx: Prisma.TransactionClient, target: ResearchTarget) { return tx.scopeAsset.findMany({ where: { programId: target.program!.id, ...((target.scopeAsset ?? target.discoveredFromAsset) ? { id: (target.scopeAsset ?? target.discoveredFromAsset)!.id } : { active: true }) }, orderBy: { id: 'asc' }, take: 1000, select: assetSelect }); }
export async function reconPanelState(userId: string, targetId: string): Promise<ReconPanelState> {
  return prisma.$transaction(async tx => {
    const target = await ownedTarget(tx, userId, targetId);
    const session = await tx.researchSession.findUnique({ where: { consoleTargetId: targetId }, select: { id: true } });
    if (!session) return { sessionId: '', snapshot: null, updateAvailable: false, aged: false, deliveries: [] };
    const [snapshot, deliveries, runs, assets] = await Promise.all([
      tx.researchReconSnapshot.findFirst({ where: { sessionId: session.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: snapshotSelect }),
      tx.researchReconDelivery.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: 'desc' }, take: 20, select: deliverySelect }),
      loadInputs(tx, target),
      loadAssets(tx, target),
    ]);
    return { sessionId: session.id, snapshot: snapshot ? { id: snapshot.id, contentSha256: snapshot.contentSha256, createdAt: snapshot.createdAt.toISOString(), context: snapshot.summary as unknown as ResearchReconContext } : null,
      updateAvailable: Boolean(snapshot && snapshot.sourceFingerprint !== fingerprint(target, runs, assets)),
      aged: Boolean(snapshot && Date.now() - snapshot.createdAt.getTime() > 7 * 86400000),
      deliveries: deliveries.map(d => ({ ...d, createdAt: d.createdAt.toISOString() })) };
  }, { timeout: 20000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export async function generateReconSnapshot(userId: string, targetId: string) {
  await ensureTargetConsole(userId, targetId);
  await prisma.$transaction(async tx => {
    const target = await ownedTarget(tx, userId, targetId, true);
    const session = await tx.researchSession.findUniqueOrThrow({ where: { consoleTargetId: targetId } });
    if (session.status !== 'READY' || Object.entries(researchAuthorizationSnapshot(target)).some(([k, v]) => (session.authorizationSnapshot as Record<string, unknown> | null)?.[k] !== v)) throw new ResearchError('Research policy changed', 409);
    const runs = await loadInputs(tx, target), assets = await loadAssets(tx, target), sourceFingerprint = fingerprint(target, runs, assets);
    let snapshot = await tx.researchReconSnapshot.findUnique({ where: { sessionId_sourceFingerprint: { sessionId: session.id, sourceFingerprint } } });
    if (!snapshot) {
      const context = buildReconContext({ programId: target.program!.id, targetId, scopeId: target.scope.id, generatedAt: new Date().toISOString(), runs: expandAssetReconRuns(runs), scopeAssets: assets, ...reconScopePolicy(target, assets),
        warnings: [...reconScopePolicy(target, assets).warnings, ...(runs.length === RECON_INPUT_LIMITS.scans ? ['Retained scan limit reached; older scans remain available in Recon.'] : [])] });
      const summary = compactReconContext(context), contentSha256 = reconHash(reconJson(context)), summarySha256 = reconHash(reconJson(summary));
      snapshot = await tx.researchReconSnapshot.create({ data: { sessionId: session.id, sourceFingerprint, contentSha256, summarySha256, context: context as unknown as Prisma.InputJsonValue, summary: summary as unknown as Prisma.InputJsonValue } });
    }
    await publishReconFiles(consoleRoot(), session.workspaceId, { contentSha256: snapshot.contentSha256, contextText: reconJson(snapshot.context), summaryText: reconJson(snapshot.summary) });
  }, { timeout: 30000 });
  return reconPanelState(userId, targetId);
}
export async function reconSnapshotDetails(userId: string, targetId: string, snapshotId: string, kind: 'assets' | 'endpoints' | 'technologies' | 'observations' | 'sources', page: number) {
  const snapshot = await prisma.researchReconSnapshot.findFirst({ where: { id: snapshotId, session: { userId, consoleTargetId: targetId, target: { userId, program: { ownerId: userId } } } }, select: { context: true } });
  if (!snapshot) throw new ResearchError('Snapshot not found', 404);
  const context = snapshot.context as unknown as ResearchReconContext;
  return { snapshotId, kind, page, total: context[kind].length, items: context[kind].slice(page * 25, (page + 1) * 25) };
}
export async function transmitReconSnapshot(userId: string, targetId: string, snapshotId: string, provider: ResearchProvider) {
  return prisma.$transaction(async tx => {
    const target = await ownedTarget(tx, userId, targetId, true);
    const snapshot = await tx.researchReconSnapshot.findFirst({ where: { id: snapshotId, session: { userId, consoleTargetId: targetId, status: 'READY' } }, include: { session: true } });
    if (!snapshot) throw new ResearchError('Snapshot not found', 404);
    if (Object.entries(researchAuthorizationSnapshot(target)).some(([k, v]) => (snapshot.session.authorizationSnapshot as Record<string, unknown> | null)?.[k] !== v)) throw new ResearchError('Research policy changed', 409);
    if (await tx.researchReconDelivery.count({ where: { sessionId: snapshot.sessionId, createdAt: { gt: new Date(Date.now() - 60000) } } }) >= 10) throw new ResearchError('Recon delivery limit reached; wait one minute', 429);
    await publishReconFiles(consoleRoot(), snapshot.session.workspaceId, { contentSha256: snapshot.contentSha256, contextText: reconJson(snapshot.context), summaryText: reconJson(snapshot.summary) });
    // Policy is read through fixed server-owned paths, never from browser input.
    const workspace = await open(join(consoleRoot(), snapshot.session.workspaceId), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    let agents, metadata, policy;
    let policySha256: string;
    try {
      agents = await open(`/proc/self/fd/${workspace.fd}/.agents`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      metadata = await open(`/proc/self/fd/${agents.fd}/bughunter`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      policy = await open(`/proc/self/fd/${metadata.fd}/policy.json`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = await policy.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024 || stat.mode & 0o222) throw new ResearchError('Unsafe console policy', 409);
      policySha256 = reconHash(await policy.readFile('utf8'));
    } finally { await policy?.close(); await metadata?.close(); await agents?.close(); await workspace.close(); }
    const delivery = await tx.researchReconDelivery.create({ data: { sessionId: snapshot.sessionId, snapshotId, provider }, select: deliverySelect });
    const token = issueReconDelivery({ targetId, sessionId: snapshot.sessionId, deliveryId: delivery.id, provider, contentSha256: snapshot.contentSha256, summarySha256: snapshot.summarySha256, policySha256 }, await readTerminalSigningKey());
    // Network uncertainty is recorded, never retried automatically (it could duplicate a paste).
    let status = 'UNKNOWN';
    try {
      const response = await fetch(new URL('/control/recon', process.env.RESEARCH_TERMINAL_CONTROL_URL ?? 'http://research-console:7681'), { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000), redirect: 'error' });
      if (response.ok) {
        const receipt = await response.json();
        status = receipt.status === 'STAGED' && receipt.provider === provider && receipt.contentSha256 === snapshot.contentSha256 ? 'STAGED' : 'UNKNOWN';
      } else status = 'REJECTED';
    } catch { /* A lost acknowledgement does not mean delivery failed. */ }
    return tx.researchReconDelivery.update({ where: { id: delivery.id }, data: { status }, select: deliverySelect });
  }, { timeout: 20000 });
}
