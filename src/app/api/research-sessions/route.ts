import { foreignOrigin } from '@/lib/requestOrigin';
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ownedResearch, researchSessionSelect } from "@/server/research/sessions";

import { paginationInput,paginationBounds } from '@/lib/pagination';
export async function GET(request?:Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params=new URLSearchParams(request?new URL(request.url).search:'');
  let input:ReturnType<typeof paginationInput>|undefined;try{if(params.has('page')||params.has('pageSize'))input=paginationInput(params);}catch{return Response.json({error:'Invalid page or pageSize'},{status:400});}
  const where={...ownedResearch(session.user.id),...(input?.q?{targetHost:{contains:input.q,mode:'insensitive' as const}}:{})};
  const result=await prisma.$transaction(async tx=>{
    const bounds=input?paginationBounds(input,await tx.researchSession.count({where})):undefined;
    const items=await tx.researchSession.findMany({where,select:researchSessionSelect,orderBy:[{createdAt:'desc'},{id:'desc'}],...(bounds?{skip:bounds.skip,take:bounds.pageSize}:{})});
    return input?{...bounds,items}:items;
  },{isolationLevel:'RepeatableRead'});
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
}
// Research runs manually in the operator's CLI; workspaces are no longer created here.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  return Response.json({ error: "Research workspaces are retired. Download the Target handoff and scope.md, then research in your local CLI." }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
