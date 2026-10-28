import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { targetIdentity } from '@/lib/research/terminal';
import { ensureProgramContext } from '@/server/programContext';
import { createScanRequest, ScanRequestQuotaExceeded } from '@/server/queue/scanRequest';
import { publishScanJob } from '@/server/queue/scanJobPublisher';
import { dispatchSelect } from '@/server/queue/scanJobPublisher';
import { withScanDispatch } from '@/lib/scanDispatch';
import { scanRejection } from '@/server/execution';
import { ResearchError } from '@/server/research/workspace';
import { foreignOrigin } from '@/lib/requestOrigin';
type Params = {params:Promise<{id:string}>};
export async function GET(_req: Request, {params}: Params) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const {id} = await params;
  if (!targetIdentity.safeParse(id).success) return Response.json({error:'Invalid target'},{status:400});
  if (!await prisma.bountyProgram.findFirst({ where: {id,ownerId:session.user.id} })) return Response.json({error:'Not found'},{status:404});
  const runs = await prisma.scanRun.findMany({ where: { target: {programId:id,userId:session.user.id,OR:[{contextOnly:true},{host:{startsWith:'*.'}}]} }, orderBy:{createdAt:'desc'}, take:30, include:{jobOutbox:{select:dispatchSelect},_count:{select:{discoveries:true}}} });
  const counts = await prisma.hostDiscovery.groupBy({by:['scanRunId','state','added'],where:{scanRunId:{in:runs.map(r=>r.id)}},_count:true});
  return Response.json(runs.map(run=>({...withScanDispatch(run),discovered:run._count.discoveries,added:counts.filter(c=>c.scanRunId===run.id&&c.added).reduce((n,c)=>n+c._count,0),excluded:counts.filter(c=>c.scanRunId===run.id&&c.state!=='VALIDATED').reduce((n,c)=>n+c._count,0)})),{headers:{'Cache-Control':'no-store'}});
}
export async function POST(_req:Request,{params}:Params) {
  const session=await auth();
  if (!session?.user?.id) return Response.json({error:'Unauthorized'},{status:401});
  if (foreignOrigin(_req)) return Response.json({error:'Forbidden'},{status:403});
  const {id}=await params;
  if (!targetIdentity.safeParse(id).success) return Response.json({error:'Invalid target'},{status:400});
  try {
    const context=await ensureProgramContext(session.user.id,id);
    const target=await prisma.target.findUniqueOrThrow({where:{id:context.id},include:{scope:true,program:true}});
    const rejection=scanRejection(target, 'RECON'); if(rejection) throw new ResearchError(rejection);
    const run=await createScanRequest(session.user.id,{targetId:context.id,type:'RECON'},null,true);
    const result=await publishScanJob(run.id);
    return Response.json({...withScanDispatch(run),...result},{status:result.dispatch==='PUBLISHED'?201:202});
  } catch(e) {
    return Response.json({error:e instanceof ResearchError||e instanceof ScanRequestQuotaExceeded?e.message:'Recon unavailable'}, {status:e instanceof ResearchError?e.status:e instanceof ScanRequestQuotaExceeded?429:503});
  }
}
