import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { sha256, targetIdentity, targetWorkspaceId } from '@/lib/research/terminal';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { withPublicationLock } from './publicationLock';
import { readPublicationManifest, makePublicationManifest, verifyPublication, publicationExists, publicationArchiveExists, writePublication, discardPublicationTemporary, discardPublicationArchive, publicationNeedsActivation, activatePublication } from './publicationFiles';
import { publicationCheckpoint } from './publicationTestHooks';
import { researchTargetSelect, assertResearchTarget, researchAuthorizationSnapshot, researchAuthorizationMatches, createResearchBundle, ResearchError, type ResearchTarget } from './workspace';
import { researchSessionSelect } from './sessions';
import { captureProgramAssessment } from '@/server/assessment';
import { capturedCoverage } from './coverage';
import { captureResearchPlanForTarget, readCapturedResearchPlan } from './plans';
import { publishCoverageFiles } from './planFiles';
import { reconJson } from './reconContext';
import { consoleBundle, consoleInventory, refreshConsoleInventory } from './consoleWorkspace';

/** Includes authoritative asset boundaries omitted by some historical snapshots. */
export function publicationPolicyIdentity(target: ResearchTarget) {
  const boundary = (asset: ResearchTarget['scopeAsset']) => asset ? { id: asset.id, programId: asset.programId, value: asset.normalizedValue, format: asset.format, active: asset.active } : null;
  return sha256(JSON.stringify({ ...researchAuthorizationSnapshot(target), active: target.active, contextOnly: target.contextOnly, asset: boundary(target.scopeAsset), discovered: boundary(target.discoveredFromAsset) }));
}
async function lockedTarget(tx: Prisma.TransactionClient, userId: string, targetId: string) {
  const owned = await tx.$queryRaw<{id: string}[]>`SELECT id FROM "Target" WHERE id=${targetId} AND "userId"=${userId} FOR UPDATE`;
  if (!owned.length) throw new ResearchError('Target not found', 404);
  let target = await tx.target.findUniqueOrThrow({ where: { id: targetId }, select: researchTargetSelect });
  await tx.$queryRaw`SELECT id FROM "Scope" WHERE id=${target.scope.id} FOR SHARE`;
  if (target.program) await tx.$queryRaw`SELECT id FROM "BountyProgram" WHERE id=${target.program.id} FOR SHARE`;
  for (const id of new Set([target.scopeAsset?.id, target.discoveredFromAsset?.id].filter((v): v is string => Boolean(v)))) await tx.$queryRaw`SELECT id FROM "ScopeAsset" WHERE id=${id} FOR SHARE`;
  target = await tx.target.findUniqueOrThrow({ where: { id: targetId }, select: researchTargetSelect });
  assertResearchTarget(target, userId);
  return target;
}

/**
 * CREATING is a committed reservation, never terminal admission. A kernel flock
 * serializes filesystem writers across processes without an open SQL transaction.
 * On crash the FD lock vanishes; the next holder can inspect the DB reservation.
 * A complete final directory is adopted only against its DB hashes and current
 * policy. Unknown finals are never adopted/removed. Incomplete token-specific
 * temp trees may be discarded; READY workspaces never enter recovery cleanup.
 * Deletion takes the same lock. The final short transaction locks policy rows,
 * revalidates the exact reservation and publishes READY. No ticket before that.
 */
export async function provisionResearch(userId: string, targetId: string, layout: 'console' | 'legacy', resumeId?: string) {
  targetIdentity.parse(targetId);
  const preflight = await prisma.target.findFirst({ where: { id: targetId, userId }, select: researchTargetSelect });
  if (!preflight) throw new ResearchError('Target not found', 404);
  assertResearchTarget(preflight, userId);
  const root = layout === 'console' ? process.env.RESEARCH_CONSOLE_ROOT ?? resolve('data/research/targets') : process.env.RESEARCH_WORKSPACE_ROOT ?? resolve('data/research/workspaces');
  const resumed = resumeId ? await prisma.researchSession.findFirst({ where: { id: resumeId, userId, targetId, consoleTargetId: null }, select: { workspaceId: true } }) : null;
  if (resumeId && !resumed) throw new ResearchError('Research session not found', 404);
  const workspaceId = layout === 'console' ? targetWorkspaceId(targetId) : resumed?.workspaceId ?? randomUUID();
  return withPublicationLock(root, workspaceId, async () => {
    const priorSession = await prisma.researchSession.findUnique({ where: { workspaceId }, select: { publicationManifest: true, status: true } });
    if ((await publicationExists(root, workspaceId) || layout === 'legacy' && await publicationArchiveExists(root, workspaceId)) && !priorSession) throw new ResearchError('Unknown existing workspace; refusing adoption', 409);
    // No filesystem I/O is allowed inside either transaction.
    const transaction = async <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => {
      await publicationCheckpoint('SQL_BEGIN');
      try { return await prisma.$transaction(work, { timeout: 15000 }); } finally { await publicationCheckpoint('SQL_END'); }
    };
    const prepared = await transaction(async tx => {
      if (layout === 'legacy') await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
      const target = await lockedTarget(tx, userId, targetId);
      if (layout === 'legacy' && target.scopeAsset && ['URL', 'WILDCARD_DOMAIN'].includes(target.scopeAsset.format)) throw new ResearchError('Use the persistent asset Research console for URL/path or wildcard scope. Historical ZIP workspaces remain unchanged.');
      const existing = await tx.researchSession.findUnique({ where: layout === 'console' ? { consoleTargetId: targetId } : { workspaceId }, select: { ...researchSessionSelect, userId: true, publicationManifest: true } });
      if (existing) {
        if (existing.userId !== userId || existing.targetId !== targetId || existing.workspaceId !== workspaceId) throw new ResearchError('Workspace reservation identity mismatch', 409);
        if (!researchAuthorizationMatches(existing.authorizationSnapshot, target)) throw new ResearchError('Research policy changed; review current Scope before retrying', 409);
        if (!['CREATING', 'READY'].includes(existing.status)) throw new ResearchError('Console workspace is unavailable', 409);
        if (existing.publicationManifest && readPublicationManifest(existing.publicationManifest).policyIdentity !== publicationPolicyIdentity(target)) throw new ResearchError('Research policy changed; review current Scope before retrying', 409);
        if (existing.status === 'READY') {
          const plan = existing.researchPlanId ? await readCapturedResearchPlan(tx, existing.researchPlanId, userId, targetId) : null;
          return { existing: true as const, session: existing, target, inventory: layout === 'console' ? await consoleInventory(tx, target) : null, coverage: await capturedCoverage(tx, userId, targetId, plan?.plan ?? null) };
        }
      }
      if (!existing && layout === 'legacy' && await tx.researchSession.count({ where: { userId, createdAt: { gt: new Date(Date.now() - 3600_000) } } }) >= 20) throw new ResearchError('Research workspace quota reached (20 per hour)', 429);
      let recon = await tx.scanRun.findFirst({ where: { targetId, type: 'RECON', status: 'COMPLETED', OR: [{ reconCorpus: { not: Prisma.DbNull } }, { artifacts: { some: {} } }, { surfaceObservations: { some: {} } }] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, reconCorpus: true } });
      const findings = await tx.finding.findMany({ where: { targetId }, orderBy: [{createdAt:'asc'},{id:'asc'}], take: 1000, select: { id: true, title: true, severity: true, vulnClass: true, reviewStatus: true, location: true } });
      const assessment = await captureProgramAssessment(tx, target.program!.id);
      const plan = existing?.researchPlanId ? await readCapturedResearchPlan(tx, existing.researchPlanId, userId, targetId) : await captureResearchPlanForTarget(tx, userId, targetId, { scanRunId: recon?.id });
      if (plan && plan.selectedScanRunId !== recon?.id) recon = await tx.scanRun.findUnique({ where: { id: plan.selectedScanRunId }, select: { id: true, reconCorpus: true } });
      const session = existing ?? await tx.researchSession.create({ data: { userId, targetId, workspaceId, ...(layout === 'console' ? { consoleTargetId: targetId } : {}), targetHost: target.host, programName: target.program!.companyName, scopeMarkdown: '', authorizationSnapshot: { ...researchAuthorizationSnapshot(target), ...assessment }, reconScanRunId: recon?.id, researchPlanId: plan?.id }, select: { ...researchSessionSelect, userId: true, publicationManifest: true } });
      const coverage = await capturedCoverage(tx, userId, targetId, plan?.plan ?? null);
      const capturedPlan = plan ? { id: plan.id, contentSha256: plan.contentSha256, jsonText: reconJson(plan.plan), markdownText: plan.markdown } : undefined;
      const files = layout === 'console' ? consoleBundle(target, recon, findings, session, capturedPlan, coverage) : createResearchBundle(target, recon, findings, session, false, capturedPlan, coverage);
      if (layout === 'console') files['recon/hosts.json'] = await consoleInventory(tx, target);
      const manifest = makePublicationManifest(files, { sessionId: session.id, targetId, workspaceId, policyIdentity: publicationPolicyIdentity(target) }, layout);
      // Keep the old manifest until disk inspection: it is the sole trusted
      // identity for crash recovery, including an incomplete prior temp tree.
      return { existing: false as const, session, target, files, manifest, reconScanRunId: recon?.id ?? null, researchPlanId: plan?.id ?? null };
    });

    let verifiedManifest = prepared.session.publicationManifest;
    if (prepared.existing) {
      // A process may have died after READY commit but before group admission.
      // Preserve its captured bytes until activation verifies the full manifest;
      // the next ordinary reconnect refreshes incremental inventory/Coverage.
      const awaitingActivation = prepared.session.publicationManifest && await publicationNeedsActivation(root, readPublicationManifest(prepared.session.publicationManifest));
      if (!awaitingActivation) {
        if (prepared.inventory) await refreshConsoleInventory(workspaceId, prepared.inventory);
        if (layout === 'console') await publishCoverageFiles(root, workspaceId, prepared.coverage);
      }
    } else {
      if (await publicationExists(root, workspaceId)) {
        if (!prepared.session.publicationManifest) throw new ResearchError('Unknown existing workspace; refusing adoption', 409);
        const prior = readPublicationManifest(prepared.session.publicationManifest);
        if (prior.layout !== layout || prior.sessionId !== prepared.session.id || prior.targetId !== targetId || prior.workspaceId !== workspaceId || prior.policyIdentity !== publicationPolicyIdentity(prepared.target)) throw new ResearchError('Workspace reservation identity mismatch', 409);
        await verifyPublication(root, prior);
        verifiedManifest = prior as unknown as Prisma.JsonValue;
      } else {
        if (prepared.session.publicationManifest) {
          const prior = readPublicationManifest(prepared.session.publicationManifest);
          if (prior.layout !== layout || prior.sessionId !== prepared.session.id || prior.workspaceId !== workspaceId || prior.targetId !== targetId) throw new ResearchError('Workspace reservation identity mismatch', 409);
          await discardPublicationTemporary(root, prior);
          await discardPublicationArchive(root, prior);
        }
        await prisma.researchSession.update({ where: { id: prepared.session.id, status: 'CREATING' }, data: { publicationManifest: prepared.manifest as unknown as Prisma.InputJsonValue, reconScanRunId: prepared.reconScanRunId, researchPlanId: prepared.researchPlanId, scopeMarkdown: prepared.files['scope.md'], files: Object.keys(prepared.files).sort(), exportSha256: prepared.manifest.archive?.sha256 ?? null } });
        verifiedManifest = prepared.manifest as unknown as Prisma.JsonValue;
        await writePublication(root, prepared.files, prepared.manifest);
        await verifyPublication(root, prepared.manifest);
      }
    }
    await publicationCheckpoint('BEFORE_READY');
    const authorizedReservation = async (tx: Prisma.TransactionClient, expectedStatus: 'READY' | 'CREATING') => {
      const target = await lockedTarget(tx, userId, targetId);
      const current = await tx.researchSession.findUniqueOrThrow({ where: { id: prepared.session.id }, select: { ...researchSessionSelect, userId: true, publicationManifest: true } });
      if (current.targetId !== targetId || current.userId !== userId || current.workspaceId !== workspaceId || !researchAuthorizationMatches(current.authorizationSnapshot, target) || current.publicationManifest && readPublicationManifest(current.publicationManifest).policyIdentity !== publicationPolicyIdentity(target)) throw new ResearchError('Research policy changed during publication', 409);
      if (sha256(reconJson(current.publicationManifest)) !== sha256(reconJson(verifiedManifest))) throw new ResearchError('Workspace reservation changed', 409);
      if (current.status !== expectedStatus) throw new ResearchError('Workspace reservation changed', 409);
      return { current, target };
    };
    const admitted = await transaction(async tx => {
      const { current, target } = await authorizedReservation(tx, prepared.existing ? 'READY' : 'CREATING');
      const session = await tx.researchSession.update({ where: { id: current.id }, data: { status: 'READY' }, select: researchSessionSelect });
      await publicationCheckpoint('READY_IN_TRANSACTION');
      return { session, target };
    });
    await publicationCheckpoint('AFTER_READY');
    // Group admission is durable I/O too. Recheck after it, so slow chmod/fsync
    // cannot cause this request to issue a ticket under an intervening revocation.
    if (verifiedManifest && await activatePublication(root, readPublicationManifest(verifiedManifest))) {
      await transaction(tx => authorizedReservation(tx, 'READY'));
    }
    return admitted;
  });
}
