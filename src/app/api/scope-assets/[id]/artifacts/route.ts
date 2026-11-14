import { withApiBoundary } from '@/lib/apiBoundary';
import {auth} from '@/lib/auth';
import {prisma} from '@/lib/prisma';
import {artifactKinds} from '@/lib/reconArtifacts';
import {artifactData,artifactSelect} from '@/server/recon/artifacts';
 async function handleGET(req:Request,{params}:{params:Promise<{id:string}>}){
 const s=await auth();if(!s?.user?.id)return Response.json({error:'Unauthorized'},{status:401});
 const{id}=await params;
 if(!await prisma.scopeAsset.findFirst({where:{id,program:{ownerId:s.user.id}}}))return Response.json({error:'Not found'},{status:404});
 const q=new URL(req.url).searchParams,run=q.get('run'),kind=q.get('kind'),requested=Number(q.get('page')??0);
 if(!run||!Number.isInteger(requested)||requested<0||requested>10000||(kind&&!artifactKinds.includes(kind as typeof artifactKinds[number])))return Response.json({error:'Invalid page or artifact kind'},{status:400});
 const where={scopeAssetId:id,scanRunId:run,scanRun:{target:{userId:s.user.id}},...(kind?{kind}:{})};
 const result=await prisma.$transaction(async tx=>{
  const total=await tx.reconArtifact.count({where}),page=Math.min(requested,Math.max(0,Math.ceil(total/100)-1));
  const rows=await tx.reconArtifact.findMany({where,select:artifactSelect,orderBy:[{kind:'asc'},{canonicalKey:'asc'},{id:'asc'}],skip:page*100,take:100});
  return{rows:rows.map(artifactData),total,page};
 },{isolationLevel:'RepeatableRead'});
 return Response.json(result,{headers:{'Cache-Control':'no-store'}});
}

export const GET = withApiBoundary(handleGET, ["id"]);
