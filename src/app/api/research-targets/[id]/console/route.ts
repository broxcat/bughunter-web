import { auth } from '@/lib/auth';
import { foreignOrigin } from '@/lib/requestOrigin';
import { deleteResearchConsole } from '@/server/research/deleteConsole';
import { ResearchError } from '@/server/research/workspace';
import { targetIdentity } from '@/lib/research/terminal';
export async function DELETE(req:Request,{params}:{params:Promise<{id:string}>}){
  const session=await auth();if(!session?.user?.id)return Response.json({error:'Unauthorized'},{status:401});
  if(foreignOrigin(req))return Response.json({error:'Forbidden'},{status:403});
  const{id}=await params;if(!targetIdentity.safeParse(id).success)return Response.json({error:'Invalid console'},{status:400});
  try{await deleteResearchConsole(session.user.id,id);return Response.json({deleted:true});}catch(e){return Response.json({error:e instanceof ResearchError?e.message:'Console cleanup incomplete; retry Delete'},{status:e instanceof ResearchError?e.status:503});}
}
