import { prisma } from '@/lib/prisma';
import { artifactData, artifactSelect, ensureLegacyArtifacts } from './artifacts';
import { ResearchError } from '../research/workspace';
import { assetValueRank,assetAllowsUrl,assetAllowsHost } from '@/lib/scopeAssets';
import { isExcluded } from '@/lib/bountyProgram';
import { classifyReconUrl, type ReconArtifactData } from '@/lib/reconArtifacts';
import { isSafeReadUrl } from '@/lib/observationSafety';

export function researchPriorities(artifacts:ReconArtifactData[],asset:{id:string;assetValue:string;type:string},changes?:unknown) {
  const changed=new Set((changes as {new?:{key:string}[]}|null)?.new?.map(i=>i.key)??[]);
  return artifacts.filter(a=>a.scopeState==='IN_SCOPE'&&(a.kind==='endpoint'||a.kind==='technology'||a.kind==='port'||a.kind==='auth-surface'||a.kind==='api-surface')).flatMap(a=>{
    if(a.kind==='port'&&a.value.state!=='open')return[];
    const url=typeof a.value.url==='string'?a.value.url:undefined,category=url?classifyReconUrl(url):a.kind;
    if(url&&(a.value.safeForActiveReview===false||!isSafeReadUrl(url)||category==='static'))return[];
    const facts:string[]=[];let score=0;
    if(category==='auth'||a.kind==='auth-surface'){facts.push('Authentication surface observed; access controls remain unverified.');score+=30;}
    if(category==='api'||a.kind==='api-surface'||asset.type==='API'){facts.push('API surface or API-classified asset.');score+=20;}
    if(category==='admin'){facts.push('Administrative-looking path observed; not proof of exposure.');score+=20;}
    if(a.kind==='technology'){facts.push('Technology signature; version unconfirmed.');score+=10;}
    if(a.kind==='port'&&a.value.state==='open'){facts.push('Open port observed; review authorized service evidence.');score+=10;}
    if(changed.has(a.canonicalKey)){if((changes as {comparable?:boolean})?.comparable){facts.push('New compared with the previous retained successful Recon.');score+=15;}else facts.push('Initial recorded inventory; no previous successful baseline is retained.');}
    if(!facts.length)return[];
    return[{artifactId:a.id,scopeAssetId:asset.id,assetValue:asset.assetValue,asset:url??String(a.value.hostname),reason:facts.join(' '),confidence:'LOW',score,observedAt:a.lastSeenAt,sources:a.sources}];
  }).sort((a,b)=>b.score-a.score||a.asset.localeCompare(b.asset)).slice(0,12);
}
export async function loadAssetReconDetail(userId:string,programId:string,assetId:string,runId?:string) {
  const asset=await prisma.scopeAsset.findFirst({where:{id:assetId,programId,program:{ownerId:userId}},include:{program:{select:{id:true,companyName:true,platform:true,programUrl:true,requiredUserAgent:true,outOfScope:true,rulesOfEngagement:true,updatedAt:true}},executionTarget:{select:{id:true,_count:{select:{researchSessions:true,findings:true}}}}}});
  if(!asset)throw new ResearchError('Scope Asset not found',404);
  const history=await prisma.scanRun.findMany({where:{scopeAssetId:assetId,type:'RECON',target:{userId,programId}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:30,select:{id:true,status:true,outcome:true,createdAt:true,startedAt:true,finishedAt:true,error:true,targetReconRunId:true,_count:{select:{artifacts:true}}}});
  const selected=runId??history[0]?.id;
  if(runId&&!await prisma.scanRun.findFirst({where:{id:runId,scopeAssetId:assetId,target:{userId,programId}}}))throw new ResearchError('Recon not found',404);
  if(selected)await ensureLegacyArtifacts(selected);
  const run=selected?await prisma.scanRun.findFirst({where:{id:selected,scopeAssetId:assetId},select:{id:true,status:true,outcome:true,createdAt:true,startedAt:true,finishedAt:true,error:true,reconPlan:true,toolVersions:true,changeSet:true,targetReconRunId:true,scopeMarkdownSha256:true,reconSteps:{orderBy:{position:'asc'}},_count:{select:{artifacts:true}}}}):null;
  const raw=selected?await prisma.reconArtifact.findMany({where:{scanRunId:selected},select:artifactSelect,orderBy:[{kind:'asc'},{canonicalKey:'asc'}],take:1000}):[];
  const artifacts=raw.map(artifactData).map(a=>{const value=typeof a.value.url==='string'?a.value.url:String(a.value.hostname??'');const host=value.startsWith('http')?new URL(value).hostname:value;
    return{...a,scopeState:asset.active&&!isExcluded(host,asset.program.outOfScope)&&(value.startsWith('http')?assetAllowsUrl(asset,value):assetAllowsHost(asset,host))?'IN_SCOPE' as const:'OUT_OF_SCOPE' as const};});
  const counts=selected?await prisma.reconArtifact.groupBy({by:['kind','scopeState'],where:{scanRunId:selected},_count:true}):[];
  if(run){const item=history.find(h=>h.id===run.id);if(item)item._count.artifacts=run._count.artifacts;}
  return{asset,run,history,artifacts,counts,discoveryCount:run?._count.artifacts??0,truncated:Boolean(run&&run._count.artifacts>artifacts.length),priorities:researchPriorities(artifacts,asset,run?.changeSet),untrustedData:true};
}
export async function listTargetAssets(userId:string,programId?:string) {
  return prisma.scopeAsset.findMany({where:{...(programId?{programId}:{}),program:{ownerId:userId}},orderBy:[{programId:'asc'},{normalizedValue:'asc'}],take:1000,include:{program:{select:{id:true,companyName:true}},scanRuns:{take:1,orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true,status:true,outcome:true,finishedAt:true,_count:{select:{artifacts:true}}}}}}).then(rows=>rows.sort((a,b)=>a.program.companyName.localeCompare(b.program.companyName)||assetValueRank(a.assetValue)-assetValueRank(b.assetValue)||a.normalizedValue.localeCompare(b.normalizedValue)));
}
