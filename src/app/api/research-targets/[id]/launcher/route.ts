import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { targetIdentity,issueLauncherTicket } from '@/lib/research/terminal';
import { launcherStatusSchema } from '@/lib/research/provider';
import { assertResearchTarget,researchTargetSelect,ResearchError } from '@/server/research/workspace';
import { readTerminalSigningKey } from '@/server/research/terminalKey';
// Read-only: no workspace provisioning, login, inference or terminal process.
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}) {
  const headers={'Cache-Control':'private, no-store'};
  const session=await auth();if(!session?.user?.id)return Response.json({error:'Unauthorized'},{status:401,headers});
  const {id}=await params;if(!targetIdentity.safeParse(id).success)return Response.json({error:'Not found'},{status:404,headers});
  try {
    const target=await prisma.target.findFirst({where:{id,userId:session.user.id},select:researchTargetSelect});
    if(!target)throw new ResearchError('Not found',404);
    assertResearchTarget(target,session.user.id);
    const token=issueLauncherTicket(id,await readTerminalSigningKey());
    const response=await fetch(new URL('/control/launcher',process.env.RESEARCH_TERMINAL_CONTROL_URL??'http://research-console:7681'),{method:'POST',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(12000),redirect:'error',cache:'no-store'});
    if(!response.ok)throw new Error('UNAVAILABLE');
    return Response.json({engines:launcherStatusSchema.parse(await response.json())},{headers});
  } catch(error) {return Response.json({error:error instanceof ResearchError?error.message:'Authentication readiness unknown; check in the native console.'},{status:error instanceof ResearchError?error.status:503,headers});}
}
