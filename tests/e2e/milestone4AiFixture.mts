import {prisma} from '../../src/lib/prisma';
import {loadReconReportFacts} from '../../src/server/recon/reportFacts';
import {runNarrativeInput} from '../../src/lib/reconRunNarrative';
import {validateReconReportV3} from '../../src/lib/reconReportV3';
import {createHash} from 'node:crypto';
const db=new URL(process.env.DATABASE_URL!);
if(db.hostname!=='127.0.0.1'||!/^postv1_[a-f0-9]+$/.test(db.searchParams.get('schema')??''))throw Error('Disposable post-v1 schema required');
const [ownerId,runId,endpoint]=process.argv.slice(2);
if(new URL(endpoint).hostname!=='127.0.0.1')throw Error('Local provider fixture required');
try {
 const facts=await loadReconReportFacts(ownerId,runId),input=runNarrativeInput(facts);
 const id=facts.scans.flatMap(s=>s.artifacts).find(a=>a.kind==='endpoint')!.id!;
 const alias=Object.entries(input.aliases).find(([,actual])=>actual===id)![0];
 const raw={title:'Recorded Recon',attackSurfaceSummary:'AI_PROSE_DO_NOT_RENDER. Evidence remains incomplete.',sections:[{category:'webSurface',entries:[{text:'Recorded observations require manual review.',confidence:'observed',evidenceRefs:[alias]}]}],notableObservations:[],limitations:[],researchHandoff:[]};
 const content=validateReconReportV3(JSON.stringify(raw),input);
 const parent=await prisma.targetReconRun.findFirstOrThrow({where:{id:runId,program:{ownerId}}});
 const saved=await prisma.aiProviderConfig.findFirstOrThrow({where:{userId:ownerId,isActive:true},select:{provider:true,model:true}});
 const row=await prisma.reconSummary.create({data:{programId:parent.programId,targetReconRunId:runId,provider:saved.provider,model:saved.model!,endpoint,promptVersion:'recon-report/3',sourceFingerprint:createHash('sha256').update(JSON.stringify(input)).digest('hex'),input:JSON.parse(JSON.stringify(input)),content:JSON.parse(JSON.stringify(content)),status:'READY',generatedAt:new Date()}});
 process.stdout.write(row.id);
}finally{await prisma.$disconnect();}
