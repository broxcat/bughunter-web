import { withApiBoundary } from '@/lib/apiBoundary';
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ownedResearch, researchSessionSelect } from "@/server/research/sessions";

import { paginationInput,paginationBounds } from '@/lib/pagination';
 async function handleGET(request?:Request) {
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

export const GET = withApiBoundary(handleGET, []);
