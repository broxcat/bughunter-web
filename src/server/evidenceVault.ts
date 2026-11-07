import {createHash,randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {evidenceCreateSchema,evidenceLinkSchema,redactEvidenceText,type EvidenceCreate,type EvidenceLink,type EvidenceView} from '@/lib/evidenceVault';
import {safeSurfaceUrl} from '@/lib/authenticatedRecon';
import {assertResearchTarget,researchAuthorizationMatches,researchTargetSelect,ResearchError,exportText} from './research/workspace';
import {ownedResearch,researchRootFor} from './research/sessions';
import {HypothesisWorkspace} from './research/hypothesisFiles';
import {reconScopePolicy} from './research/reconPolicy';
const clean=(v:string)=>redactEvidenceText(exportText(v)).slice(0,4000);
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export async function ownedEvidenceTarget(tx:Prisma.TransactionClient,userId:string,targetId:string,write=false,requireActive=write){
 if(write)await tx.$queryRaw`SELECT id FROM "Target" WHERE id=${targetId} AND "userId"=${userId} FOR UPDATE`;
 const target=await tx.target.findFirst({where:{id:targetId,userId,program:{ownerId:userId,deletingAt:null}},select:researchTargetSelect});
 if(!target)throw new ResearchError('Target not found',404);if(requireActive)assertResearchTarget(target,userId);return target;
}
function safeMetadata(value:unknown,depth=0):unknown{
 if(depth>12)return '[REDACTED NESTED DATA]';if(typeof value==='string')return clean(value);if(Array.isArray(value))return value.map(v=>safeMetadata(v,depth+1));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/password|authorization|cookie|secret|token|api.?key|cipher|sessionIdentity|credential/i.test(key)?'[REDACTED CREDENTIAL]':safeMetadata(item,depth+1)]));return value;
}
export function evidenceView(row:Prisma.EvidenceRecordGetPayload<object>):EvidenceView{return{id:row.id,targetId:row.targetId,kind:row.kind,description:clean(row.description),createdAt:row.createdAt.toISOString(),contentSha256:row.contentSha256,redactionStatus:row.redactionStatus,provenance:safeMetadata(row.provenance) as Record<string,unknown>,metadata:safeMetadata(row.metadata) as Record<string,unknown>};}
async function reference(tx:Prisma.TransactionClient,userId:string,targetId:string,link:EvidenceLink){
 if(link.entity==='hypothesis'){
  const h=await tx.researchHypothesis.findFirst({where:{id:link.id,session:{userId,targetId}},select:{id:true,revision:true}});if(!h)throw new ResearchError('Hypothesis not found',404);return h;
 }
 if(link.entity==='finding'){if(!await tx.finding.findFirst({where:{id:link.id,targetId},select:{id:true}}))throw new ResearchError('Finding not found',404);return null;}
 if(!await tx.researchCoverageEvent.findFirst({where:{id:link.id,targetId},select:{id:true}}))throw new ResearchError('Coverage test not found',404);return null;
}
export async function linkEvidence(tx:Prisma.TransactionClient,userId:string,targetId:string,evidenceId:string,raw:unknown){
 const parsed=evidenceLinkSchema.safeParse(raw);if(!parsed.success)throw new ResearchError('Invalid evidence relationship',400);const link=parsed.data;
 if(!await tx.evidenceRecord.findFirst({where:{id:evidenceId,targetId},select:{id:true}}))throw new ResearchError('Evidence not found',404);
 const h=await reference(tx,userId,targetId,link);
 if(link.entity==='hypothesis')await tx.evidenceHypothesis.createMany({data:[{evidenceId,hypothesisId:link.id,hypothesisReferenceId:link.id,revision:h!.revision,role:link.role}],skipDuplicates:true});
 else if(link.entity==='finding')await tx.evidenceFinding.createMany({data:[{evidenceId,findingId:link.id,findingReferenceId:link.id,role:link.role}],skipDuplicates:true});
 else await tx.evidenceCoverage.createMany({data:[{evidenceId,coverageEventId:link.id}],skipDuplicates:true});
}
/** Metadata and fixed safe references only; source bodies/headers are never copied. */
export async function registerEvidence(tx:Prisma.TransactionClient,userId:string,targetId:string,input:EvidenceCreate){
 const target=await ownedEvidenceTarget(tx,userId,targetId,true,input.kind!=='RECON_ARTIFACT');
 let sessionId:string|null=null,contentSha256:string|null=null,reconArtifactId:string|null=null;
 let metadata:Record<string,unknown>={},provenance:Record<string,unknown>={},sourceKey:string,redactionStatus:string;
 if(input.kind==='RECON_ARTIFACT'){
  const artifact=await tx.reconArtifact.findFirst({where:{id:input.artifactId,scanRun:{targetId,target:{userId}}},select:{id:true,kind:true,scanRunId:true,scopeAssetId:true,scopeState:true,verification:true,firstSeenAt:true,lastSeenAt:true}});
  if(!artifact)throw new ResearchError('Recon artifact not found for this Target',404);
  reconArtifactId=artifact.id;sourceKey=hash(['recon',artifact.id]);redactionStatus='REFERENCE_ONLY_CONTENT_NOT_COPIED';
  provenance={source:'RECON_ARTIFACT',artifactReferenceId:artifact.id,scanRunId:artifact.scanRunId,scopeAssetId:artifact.scopeAssetId};metadata={artifactKind:artifact.kind,scopeState:artifact.scopeState,verification:artifact.verification,firstSeenAt:artifact.firstSeenAt,lastSeenAt:artifact.lastSeenAt,authorizationGranted:false};
 }else{
  const session=await tx.researchSession.findFirst({where:{id:input.sessionId,targetId,...ownedResearch(userId),status:'READY'},select:{id:true,workspaceId:true,authorizationSnapshot:true}});
  if(!session)throw new ResearchError('Ready Research session not found',404);
  if(!researchAuthorizationMatches(session.authorizationSnapshot,target))throw new ResearchError('Research policy changed',409);sessionId=session.id;
  if(input.kind==='HTTP_REQUEST_RESPONSE'){
   if(!reconScopePolicy(target).inScope(input.http.url))throw new ResearchError('HTTP evidence must belong to the authorized Target surface',400);
   if(Date.parse(input.observedAt)>Date.now()+60000)throw new ResearchError('Invalid observation date',400);
   metadata={request:{method:input.http.method,url:safeSurfaceUrl(input.http.url),excerpt:input.http.requestExcerpt?clean(input.http.requestExcerpt):null,requestable:false},response:{statusCode:input.http.statusCode,contentType:input.http.contentType?clean(input.http.contentType):null,excerpt:input.http.responseExcerpt?clean(input.http.responseExcerpt):null}};
   contentSha256=hash(metadata);provenance={source:'EXPLICIT_RESEARCHER_HTTP_CAPTURE',sessionReferenceId:session.id,observedAt:input.observedAt};sourceKey=hash(['http',session.id,input.observedAt,contentSha256]);redactionStatus='REDACTED_METADATA_AND_EXCERPTS';
  }else{
   if(clean(input.ref)!==input.ref)throw new ResearchError('Artifact names must not contain secrets',400);
   if(input.kind==='BURP_REFERENCE'&&!/^(?:requests|evidence)\/burp\//.test(input.ref))throw new ResearchError('Use an existing bounded Burp artifact reference',400);
   const workspace=await HypothesisWorkspace.open(researchRootFor(session.workspaceId),session.workspaceId);
   try{contentSha256=await workspace.fingerprintReference(input.ref);}finally{await workspace.close();}
   provenance={source:input.kind==='BURP_REFERENCE'?'BURP_WORKSPACE_REFERENCE':'RESEARCH_WORKSPACE_REFERENCE',sessionReferenceId:session.id,ref:input.ref};metadata={ref:input.ref,sourceContentCopied:false};sourceKey=hash(['workspace',session.id,input.ref,contentSha256]);redactionStatus='REFERENCE_ONLY_CONTENT_NOT_COPIED';
  }
 }
 const existing=await tx.evidenceRecord.findUnique({where:{targetId_sourceKey:{targetId,sourceKey}}});
 if(!existing&&await tx.evidenceRecord.count({where:{targetId}})>=5000)throw new ResearchError('Evidence limit reached; retained records remain available',422);
 const row=existing??await tx.evidenceRecord.create({data:{id:'EV-'+randomUUID(),targetId,sessionId,sessionReferenceId:sessionId,kind:input.kind,sourceKey,description:clean(input.description),provenance:json(provenance),metadata:json(metadata),contentSha256,reconArtifactId,reconArtifactReferenceId:reconArtifactId,redactionStatus}});
 if(input.link)await linkEvidence(tx,userId,targetId,row.id,input.link);return row;
}
export async function createEvidence(userId:string,targetId:string,raw:unknown){const parsed=evidenceCreateSchema.safeParse(raw);if(!parsed.success)throw new ResearchError('Invalid evidence metadata. Raw headers, credentials and arbitrary source URLs are not accepted.',400);return prisma.$transaction(async tx=>evidenceView(await registerEvidence(tx,userId,targetId,parsed.data)),{timeout:20000});}
export async function attachEvidence(userId:string,targetId:string,evidenceId:string,link:unknown){return prisma.$transaction(async tx=>{await ownedEvidenceTarget(tx,userId,targetId,true,false);await linkEvidence(tx,userId,targetId,evidenceId,link);return{id:evidenceId};});}
export async function listEvidence(userId:string,targetId:string,filter:{hypothesisId?:string;findingId?:string;coverageEventId?:string;reportId?:string}={},before?:string){
 return prisma.$transaction(async tx=>{
  await ownedEvidenceTarget(tx,userId,targetId);
  const where:Prisma.EvidenceRecordWhereInput={targetId};
  if(filter.hypothesisId){await reference(tx,userId,targetId,{entity:'hypothesis',id:filter.hypothesisId,role:'CONTEXT'});where.hypotheses={some:{hypothesisReferenceId:filter.hypothesisId}};}
  if(filter.findingId){await reference(tx,userId,targetId,{entity:'finding',id:filter.findingId,role:'CONTEXT'});where.findings={some:{findingReferenceId:filter.findingId}};}
  if(filter.coverageEventId){await reference(tx,userId,targetId,{entity:'coverage',id:filter.coverageEventId});where.coverage={some:{coverageEventId:filter.coverageEventId}};}
  if(filter.reportId){if(!await tx.report.findFirst({where:{id:filter.reportId,userId},select:{id:true}}))throw new ResearchError('Report not found',404);where.reports={some:{reportReferenceId:filter.reportId}};}
  let cursor:{createdAt:Date;id:string}|undefined;
  if(before){
   try{if(before.length>512)throw new Error();const raw=JSON.parse(Buffer.from(before,'base64url').toString('utf8'));
    if(!raw||typeof raw.id!=='string'||!/^[A-Za-z0-9_-]{1,150}$/.test(raw.id)||typeof raw.createdAt!=='string'||new Date(raw.createdAt).toISOString()!==raw.createdAt)throw new Error();
    cursor={id:raw.id,createdAt:new Date(raw.createdAt)};
   }catch{throw new ResearchError('Invalid evidence cursor',400);}
  }
  const include={hypotheses:{select:{hypothesisReferenceId:true,revision:true,role:true}},findings:{select:{findingReferenceId:true,role:true}},reports:{select:{reportReferenceId:true}},coverage:{select:{coverageEventId:true}}} as const;
  const read=(after?:typeof cursor)=>tx.evidenceRecord.findMany({where:{...where,...(after?{OR:[{createdAt:{lt:after.createdAt}},{createdAt:after.createdAt,id:{lt:after.id}}]}:{})},orderBy:[{createdAt:'desc'},{id:'desc'}],take:101,include});
  let rows=await read(cursor),reset=false;
  // A removed cursor row does not invalidate its immutable key. If the entire
  // older window disappeared, return newest retained records rather than trap
  // a caller on an empty page while previous results still exist.
  if(cursor&&!rows.length){rows=await read();reset=true;}
  const selected=rows.slice(0,100),last=selected.at(-1),truncated=rows.length>100;
  return{items:selected.map(row=>({...evidenceView(row),relations:[...row.hypotheses.map(r=>({entity:'hypothesis',id:r.hypothesisReferenceId,role:r.role,revision:r.revision})),...row.findings.map(r=>({entity:'finding',id:r.findingReferenceId,role:r.role})),...row.reports.map(r=>({entity:'report',id:r.reportReferenceId})),...row.coverage.map(r=>({entity:'coverage',id:r.coverageEventId}))]})),truncated,reset,
   nextCursor:truncated&&last?Buffer.from(JSON.stringify({createdAt:last.createdAt.toISOString(),id:last.id})).toString('base64url'):null};
 },{isolationLevel:'RepeatableRead'});
}
export async function getEvidence(userId:string,targetId:string,evidenceId:string){return prisma.$transaction(async tx=>{await ownedEvidenceTarget(tx,userId,targetId);const row=await tx.evidenceRecord.findFirst({where:{id:evidenceId,targetId}});if(!row)throw new ResearchError('Evidence not found',404);return evidenceView(row);});}
