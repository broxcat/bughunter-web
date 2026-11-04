import {auth} from '@/lib/auth';
import {targetIdentity} from '@/lib/research/terminal';
import {researchPlanDetails} from '@/server/research/plans';
import {ResearchError} from '@/server/research/workspace';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  const session=await auth();if(!session?.user?.id)return json({error:'Unauthorized'},401);
  const id=targetIdentity.safeParse((await params).id);if(!id.success)return json({error:'Not found'},404);
  try{return json(await researchPlanDetails(session.user.id,id.data));}catch(cause){return json({error:cause instanceof ResearchError?cause.message:'Research plan unavailable'},cause instanceof ResearchError?cause.status:503);}
}
