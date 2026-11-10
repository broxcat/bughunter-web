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
type AssetInput = {value:string;format?:AssetFormat;type?:'API'|'WEB_APPLICATION'|'WILDCARD'|'OTHER';assetValue:'CRITICAL'|'HIGH'|'MEDIUM'|'LOW'};
const nextAssetTime=(previous:Date)=>new Date(Math.max(Date.now(),previous.getTime()+1));
function checkAssetVersion(asset:{updatedAt:Date},expected?:string){
  if(expected&&asset.updatedAt.toISOString()!==expected)throw new ResearchError('Scope changed. Reload the asset before saving.',409);
}
/** Caller holds the owned Program lock. No filesystem or native-console I/O here. */
async function admitAsset(tx:Prisma.TransactionClient,program:Prisma.BountyProgramGetPayload<object>,input:AssetInput,capacityCredit=0){
  const detected=detectScopeAsset(input.value);
  let identity={format:detected.format,normalizedValue:detected.normalizedValue};
  if(input.format){try{const choice=overrideAssetFormat(detected,input.format);identity={format:choice.format,normalizedValue:choice.normalizedValue};}catch(e){throw new ResearchError((e as Error).message,422);}}
  const old=await tx.scopeAsset.findUnique({where:{programId_normalizedValue:{programId:program.id,normalizedValue:identity.normalizedValue}}});
  if(old?.active)throw new ResearchError('This asset is already in scope',409);
  // Retained history reserves its Format/value pair. Reauthorization can reuse
  // that identity, but must never reinterpret an old execution Target.
  if(old&&old.format!==identity.format)throw new ResearchError('This value belongs to a retained identity with another Format. Choose a different replacement value.',409);
  if(await tx.scopeAsset.count({where:{programId:program.id,active:true}})>=1000+capacityCredit)throw new ResearchError('Scope limit reached (1000 active assets)',429);
  const asset=old?await tx.scopeAsset.update({where:{id:old.id},data:{active:true,assetValue:input.assetValue,...(input.type?{type:input.type,typeSource:'USER'}:{}),updatedAt:nextAssetTime(old.updatedAt)}}):await tx.scopeAsset.create({data:{programId:program.id,originalValue:input.value,...identity,formatSource:input.format?'MANUAL':'AUTO',type:input.type??detected.inferredType,typeSource:input.type?'USER':'HEURISTIC',assetValue:input.assetValue}});
  if(['DOMAIN','SUBDOMAIN','WILDCARD_DOMAIN'].includes(asset.format)&&!program.scopeRules.includes(asset.normalizedValue))await tx.bountyProgram.update({where:{id:program.id},data:{scopeRules:[...program.scopeRules,asset.normalizedValue]}});
  return asset;
}
export async function retireScopeAssetInTransaction(tx:Prisma.TransactionClient,programId:string,asset:Prisma.ScopeAssetGetPayload<object>){
  await tx.scanRun.updateMany({where:{OR:[{scopeAssetId:asset.id},{target:{discoveredFromAssetId:asset.id}}],status:{in:['QUEUED','RUNNING']}},data:{cancelRequestedAt:new Date()}});
  await tx.reconSummary.updateMany({where:{scopeAssetId:asset.id,status:{in:['PENDING','RUNNING']}},data:{status:'CANCELLED'}});
  const program=await tx.bountyProgram.findUniqueOrThrow({where:{id:programId}});
  await tx.bountyProgram.update({where:{id:programId},data:{scopeRules:program.scopeRules.filter(rule=>rule!==asset.normalizedValue)}});
  // Preserve immutable Target/Scope identity and every historical relation.
  return tx.scopeAsset.update({where:{id:asset.id},data:{active:false,updatedAt:nextAssetTime(asset.updatedAt)}});
}
export async function settleScopeAssetRetirement(){
  const {settleQueuedCancellations}=await import('./queue/scanCancellation');await settleQueuedCancellations();
}
export async function createScopeAsset(userId:string,programId:string,input:AssetInput){
  return prisma.$transaction(async tx=>{
    const program=await lockOwnedProgram(tx,userId,programId);await backfillProgramAssets(tx,programId,userId);
    return admitAsset(tx,program,input);
  },{timeout:30000});
}
export async function editScopeAsset(userId:string,programId:string,assetId:string,input:{format?:AssetFormat;resetFormatToAuto?:boolean;confirmBoundaryChange?:boolean;type?:'API'|'WEB_APPLICATION'|'WILDCARD'|'OTHER';assetValue?:'CRITICAL'|'HIGH'|'MEDIUM'|'LOW';expectedUpdatedAt?:string}|null,expectedRetirementVersion?:string){
  const result=await prisma.$transaction(async tx=>{
    await lockOwnedProgram(tx,userId,programId);
    const asset=await tx.scopeAsset.findFirst({where:{id:assetId,programId,...(input?{active:true}:{})}});
    if(!asset)throw new ResearchError('Asset not found',404);
    checkAssetVersion(asset,input?.expectedUpdatedAt??expectedRetirementVersion);
    if(!input)return retireScopeAssetInTransaction(tx,programId,asset);
    const {format,resetFormatToAuto}=input;
    const fields={...(input.type?{type:input.type}:{}),...(input.assetValue?{assetValue:input.assetValue}:{})};
    const choice=resetFormatToAuto?detectScopeAsset(asset.originalValue).format:format;
    let change;try{change=choice?overrideAssetFormat(asset,choice):null;}catch(e){throw new ResearchError((e as Error).message,422);}
    if(change&&(change.normalizedValue!==asset.normalizedValue||change.format!==asset.format))throw new ResearchError('Format and normalized value identify this asset. Use explicit replacement; existing execution identities cannot be changed.',409);
    return tx.scopeAsset.update({where:{id:assetId},data:{...fields,...(fields.type?{typeSource:'USER'}:{}),...(change?{formatSource:resetFormatToAuto?'AUTO':'MANUAL'}:{}),updatedAt:nextAssetTime(asset.updatedAt)}});
  });
  if(!input)try{await settleScopeAssetRetirement();}catch{throw new ResearchError('Scope authorization retired; scan cancellation is unconfirmed. Retry cleanup from the retired asset.',503);}
  return result;
}
/** One Program lock serializes replacement, metadata edits, retirement and
 * Recon admission. Creation failure rolls back everything. A process dying
 * after commit leaves a new authorization and a revoked historical identity;
 * retrying DELETE on the old identity safely retries native cleanup only. */
export async function replaceScopeAsset(userId:string,programId:string,assetId:string,input:AssetInput&{expectedUpdatedAt:string}){
  const replacement=await prisma.$transaction(async tx=>{
    const program=await lockOwnedProgram(tx,userId,programId);
    const original=await tx.scopeAsset.findFirst({where:{id:assetId,programId}});
    if(!original)throw new ResearchError('Asset not found',404);
    if(!original.active)throw new ResearchError('This asset has already been retired. Reload Scope.',409);
    checkAssetVersion(original,input.expectedUpdatedAt);
    await backfillProgramAssets(tx,programId,userId);
    const asset=await admitAsset(tx,program,input,1);
    await retireScopeAssetInTransaction(tx,programId,original);
    return asset;
  },{timeout:30000});
  // Authorization is already committed: never report a failed creation when
  // only post-commit quiescence failed. Expose a retryable cleanup warning.
  let cleanupWarning:string|undefined;
  try{await settleScopeAssetRetirement();}catch{cleanupWarning='Replacement saved and original authorization revoked. Scan cancellation is unconfirmed; retry cleanup from the retired asset.';}
  return{asset:replacement,retiredAssetId:assetId,...(cleanupWarning?{cleanupWarning}:{})};
}
export async function ensureAssetExecution(userId: string, programId: string, assetId: string) {
  return prisma.$transaction(async tx => {
    const program = await lockOwnedProgram(tx, userId, programId);
    return ensureAssetExecutionInTransaction(tx, userId, program, assetId);
  });
}

export async function ensureAssetExecutionInTransaction(tx: Prisma.TransactionClient, userId: string, program: Prisma.BountyProgramGetPayload<object>, assetId: string) {
  const programId = program.id;
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
