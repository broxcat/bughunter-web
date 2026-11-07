import { foreignOrigin } from '@/lib/requestOrigin';
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { createResearchSession, ownedResearch, researchSessionSelect } from "@/server/research/sessions";
import { ResearchError } from "@/server/research/workspace";

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
const input = z.object({ targetId: z.string().min(1).max(200) }).strict();
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Provide only a targetId" }, { status: 400 });
  try {
    // Archival compatibility export only. Active consoles use the per-Target ticket API.
    return Response.json(await createResearchSession(session.user.id, parsed.data.targetId), { status: 201, headers: { "Cache-Control": "no-store", "Deprecation": "true" } });
  } catch (error) {
    const known = error instanceof ResearchError;
    const status = known ? error.status : 500;
    return Response.json({ error: known ? error.message : "Unable to create research workspace" }, { status, headers: status === 429 ? { "Retry-After": "3600" } : {} });
  }
}
