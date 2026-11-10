import {auth} from '@/lib/auth';
import {targetIdentity} from '@/lib/research/identity';
import {researchPlanState} from '@/server/research/plans';
import {ResearchError} from '@/server/research/workspace';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(request:Request){
  const session=await auth();if(!session?.user?.id)return json({error:'Unauthorized'},401);
  const id=targetIdentity.safeParse(new URL(request.url).searchParams.get('targetId'));if(!id.success)return json({error:'A valid targetId is required'},400);
  try{return json(await researchPlanState(session.user.id,id.data));}catch(cause){return json({error:cause instanceof ResearchError?cause.message:'Research plan unavailable'},cause instanceof ResearchError?cause.status:503);}
}
