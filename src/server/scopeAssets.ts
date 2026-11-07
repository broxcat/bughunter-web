import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { detectScopeAsset, assetValueRank, assetReconStatus, assetAllowsHost, overrideAssetFormat, scopeAssetExecutable, type AssetFormat } from '@/lib/scopeAssets';
import { assetAllowsUrl } from '@/lib/scopeAssets';
import { isExcluded } from '@/lib/bountyProgram';
import { ResearchError } from './research/workspace';
export const assetError = (error: unknown) => Response.json({ error: error instanceof ResearchError ? error.message : error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' ? 'Asset already exists' : 'Asset operation unavailable' }, { status: error instanceof ResearchError ? error.status : error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' ? 409 : 503 });

export const assetSelect = { id: true, programId: true, originalValue: true, normalizedValue: true, format: true, formatSource: true, type: true, typeSource: true, assetValue: true, active: true, createdAt: true, updatedAt: true } as const;
export async function lockOwnedProgram(tx: Prisma.TransactionClient, userId: string, programId: string) {
  const rows = await tx.$queryRaw`SELECT id FROM "BountyProgram" WHERE id=${programId} AND "ownerId"=${userId} AND "deletingAt" IS NULL FOR UPDATE`;
  if (!(rows as unknown[]).length) throw new ResearchError('Target not found', 404);
  return tx.bountyProgram.findUniqueOrThrow({ where: { id: programId } });
}
/** Idempotent compatibility for rules added by older API clients after migration. */
export async function backfillProgramAssets(tx: Prisma.TransactionClient, programId: string, userId: string) {
  const program = await tx.bountyProgram.findUniqueOrThrow({ where: { id: programId } });
  const hosts = await tx.target.findMany({ where: { programId, userId, active: true, contextOnly: false, discoverySource: null }, orderBy: [{createdAt:'asc'},{id:'asc'}] });
  for (const value of [...new Set([...program.scopeRules, ...hosts.map(h => h.host)])]) {
    let detected; try { detected = detectScopeAsset(value); } catch { continue; }
    if(await tx.scopeAsset.findFirst({where:{programId,originalValue:value,formatSource:'MANUAL'}}))continue;
    const asset = await tx.scopeAsset.upsert({ where: { programId_normalizedValue: { programId, normalizedValue: detected.normalizedValue } }, create: { programId, originalValue: value, normalizedValue: detected.normalizedValue, format: detected.format, type: detected.inferredType, typeSource: 'BACKFILL' }, update: {} });
    const host = hosts.find(h => h.host === detected.normalizedValue && !h.scopeAssetId);
    if (host && !await tx.target.findUnique({ where: { scopeAssetId: asset.id } })) {
      await tx.target.update({ where: { id: host.id }, data: { scopeAssetId: asset.id } });
      await tx.scanRun.updateMany({ where: { targetId: host.id, type: 'RECON', scopeAssetId: null }, data: { scopeAssetId: asset.id } });
    }
  }
}
export async function listScopeAssets(userId: string, programId: string) {
  const result = await prisma.$transaction(async tx => {
    await lockOwnedProgram(tx, userId, programId); await backfillProgramAssets(tx, programId, userId);
    const assets = await tx.scopeAsset.findMany({ where: { programId }, select: { ...assetSelect,
      executionTarget: { select: { id: true, _count: { select: { researchSessions: true, findings: true } } } },
      scanRuns: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20, select: { id: true, artifactVersion:true, status: true, outcome: true, createdAt: true, startedAt: true, finishedAt: true, error: true, reconSteps: { orderBy: { position: 'asc' } }, _count: { select: { discoveries: true, artifacts: true } } } },
      _count: { select: { discoveredTargets: true, scanRuns: true } },
    } });
    return assets.sort((a, b) => assetValueRank(a.assetValue) - assetValueRank(b.assetValue) || a.normalizedValue.localeCompare(b.normalizedValue)).map(asset => ({ ...asset,
      reconStatus: assetReconStatus(asset.scanRuns[0] ?? null), executable: scopeAssetExecutable(asset),
      scanRunWindowLimit:20,scanRunsTruncated:asset._count.scanRuns>asset.scanRuns.length,
      researchStatus: asset.executionTarget?._count.researchSessions ? 'STARTED' : 'NOT_STARTED',
    }));
  }, { timeout: 30000 });
  const {ensureLegacyArtifacts}=await import('./recon/artifacts');
  for(const asset of result){const run=asset.scanRuns[0];if(run&&run.artifactVersion<2&&!['RUNNING','QUEUED'].includes(run.status)){await ensureLegacyArtifacts(run.id);run._count.artifacts=await prisma.reconArtifact.count({where:{scanRunId:run.id}});}}
  return result;
}
export async function createScopeAsset(userId: string, programId: string, input: { value: string; type?: 'API' | 'WEB_APPLICATION' | 'WILDCARD' | 'OTHER'; assetValue: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' }) {
  const detected = detectScopeAsset(input.value);
  return prisma.$transaction(async tx => {
    const program = await lockOwnedProgram(tx, userId, programId);
    await backfillProgramAssets(tx, programId, userId);
    if (await tx.scopeAsset.count({ where: { programId, active: true } }) >= 1000) throw new ResearchError('Scope limit reached (1000 active assets)', 429);
    const old = await tx.scopeAsset.findUnique({ where: { programId_normalizedValue: { programId, normalizedValue: detected.normalizedValue } } });
    if (old?.active) throw new ResearchError('This asset is already in scope', 409);
    const data = { originalValue: input.value, normalizedValue: detected.normalizedValue, format: detected.format, type: input.type ?? detected.inferredType, typeSource: input.type ? 'USER' : 'HEURISTIC', assetValue: input.assetValue, active: true };
    const asset = old ? await tx.scopeAsset.update({ where: { id: old.id }, data: old.formatSource==='MANUAL'?{active:true,...(input.type?{type:input.type,typeSource:'USER'}:{}),assetValue:input.assetValue}:data }) : await tx.scopeAsset.create({ data: { programId, ...data } });
    if (['DOMAIN', 'SUBDOMAIN', 'WILDCARD_DOMAIN'].includes(detected.format) && !program.scopeRules.includes(detected.normalizedValue)) await tx.bountyProgram.update({ where: { id: programId }, data: { scopeRules: [...program.scopeRules, detected.normalizedValue] } });
    return asset;
  }, { timeout: 30000 });
}
export async function editScopeAsset(userId: string, programId: string, assetId: string, input: { format?: AssetFormat; resetFormatToAuto?:boolean; confirmBoundaryChange?:boolean; type?: 'API' | 'WEB_APPLICATION' | 'WILDCARD' | 'OTHER'; assetValue?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' } | null) {
  const result = await prisma.$transaction(async tx => {
    const program = await lockOwnedProgram(tx, userId, programId);
    const asset = await tx.scopeAsset.findFirst({ where: { id: assetId, programId, ...(input ? {active:true} : {}) } });
    if (!asset) throw new ResearchError('Asset not found', 404);
    if (input) {
      const {format,resetFormatToAuto,confirmBoundaryChange,...fields}=input;
      const choice=resetFormatToAuto ? detectScopeAsset(asset.originalValue).format : format;
      let change;try{change=choice ? overrideAssetFormat(asset,choice) : null;}catch(e){throw new ResearchError((e as Error).message,422);}
      if(change?.requiresConfirmation && !confirmBoundaryChange) throw new ResearchError('Confirm the changed authorization boundary before saving this format',409);
      if(change && change.normalizedValue !== asset.normalizedValue) {
        await tx.bountyProgram.update({where:{id:programId},data:{scopeRules:[...program.scopeRules.filter(r=>r!==asset.normalizedValue),change.normalizedValue]}});
        const host=change.format==='URL'?new URL(change.normalizedValue).hostname:change.normalizedValue;
        const target=await tx.target.findUnique({where:{scopeAssetId:assetId}});
        if(target){await tx.target.update({where:{id:target.id},data:{host,scheme:change.format==='URL'?new URL(change.normalizedValue).protocol.slice(0,-1):'https'}});await tx.scope.update({where:{id:target.scopeId},data:{hostPattern:host}});}
      }
      return tx.scopeAsset.update({where:{id:assetId},data:{...fields,...(fields.type?{typeSource:'USER'}:{}),...(change?{format:change.format,normalizedValue:change.normalizedValue,formatSource:resetFormatToAuto?'AUTO':'MANUAL'}:{})}});
    }
    await tx.scanRun.updateMany({where:{OR:[{scopeAssetId:assetId},{target:{discoveredFromAssetId:assetId}}],status:{in:['QUEUED','RUNNING']}},data:{cancelRequestedAt:new Date()}});
    await tx.reconSummary.updateMany({where:{scopeAssetId:assetId,status:{in:['PENDING','RUNNING']}},data:{status:'CANCELLED'}});
    // Archive the authorization. Scans, discoveries, snapshots and Findings remain readable.
    await tx.bountyProgram.update({ where: { id: programId }, data: { scopeRules: program.scopeRules.filter(rule => rule !== asset.normalizedValue) } });
    return tx.scopeAsset.update({ where: { id: assetId }, data: { active: false } });
  });
  if(!input || input.format || input.resetFormatToAuto){const {pauseAssetResearch}=await import('./research/archiveAsset');await pauseAssetResearch(userId,assetId);const {settleQueuedCancellations}=await import('./queue/scanCancellation');await settleQueuedCancellations();}
  return result;
}
export async function ensureAssetExecution(userId: string, programId: string, assetId: string) {
  return prisma.$transaction(async tx => {
    const program = await lockOwnedProgram(tx, userId, programId);
    const asset = await tx.scopeAsset.findFirst({ where: { id: assetId, programId, active: true }, include: { executionTarget: true } });
    if (!asset) throw new ResearchError('Asset not found', 404);
    const detected = detectScopeAsset(asset.normalizedValue);
    if (!scopeAssetExecutable(asset)) throw new ResearchError('This format is documented but has no authorized Recon/Research executor yet', 422);
    const host = detected.hostname ?? asset.normalizedValue;
    if (asset.format !== 'WILDCARD_DOMAIN' && isExcluded(host, program.outOfScope)) throw new ResearchError('Asset is excluded by program policy', 403);
    if (asset.executionTarget) return { asset, target: asset.executionTarget };
    const scope = await tx.scope.create({ data: { userId, hostPattern: host, status: 'APPROVED', programName: program.companyName } });
    // Dedicated execution identities avoid merging two URL/path assets on one host.
    const target = await tx.target.create({ data: { userId, programId, scopeId: scope.id, scopeAssetId: assetId, host,
      scheme: asset.format === 'URL' ? new URL(asset.normalizedValue).protocol.slice(0, -1) : 'https', contextOnly: false, active: false } });
    return { asset, target };
  });
}
export function assetSnapshot(asset: { id: string; programId: string; normalizedValue: string; originalValue: string; format: string; formatSource?:string; type: string; assetValue: string }) {
  return { schemaVersion: 1, assetId: asset.id, programId: asset.programId, originalValue: asset.originalValue, normalizedValue: asset.normalizedValue, format: asset.format, formatSource:asset.formatSource??'AUTO', type: asset.type, assetValue: asset.assetValue };
}
export const assetHostAllowed = (asset: { normalizedValue: string; format: string; active: boolean }, host: string, exclusions: string[]) => assetAllowsHost(asset, host) && !isExcluded(host, exclusions);
/** Reuse observations from compatible entries on the same owned Target. This
 * selects evidence, not authorization; the destination asset still gates use. */
export async function scopeAssetSourceIds(db: Pick<Prisma.TransactionClient, 'scopeAsset'>, asset: { id: string; programId: string; format: string; normalizedValue: string }) {
  if (asset.format === 'WILDCARD_DOMAIN') return [asset.id];
  const host = asset.format === 'URL' ? new URL(asset.normalizedValue).hostname : asset.normalizedValue;
  const candidates = await db.scopeAsset.findMany({ where: { programId: asset.programId }, select: { id: true, normalizedValue: true, format: true }, orderBy:{id:'asc'}, take: 1000 });
  return [...new Set([asset.id, ...candidates.filter(a => asset.format === 'URL' ? assetAllowsUrl(a, asset.normalizedValue) : assetAllowsHost(a, host)).map(a => a.id)])];
}
