import { withApiBoundary } from '@/lib/apiBoundary';
import {paginationInput,paginationBounds} from '@/lib/pagination';
import {publicFinding} from '@/server/findingPrivacy';
import { executionSelect } from "@/server/queue/executionAttempts";
import { withScanDispatch } from "@/lib/scanDispatch";
import { dispatchSelect } from "@/server/queue/scanJobPublisher";
import { programPolicyInclude, type PolicyProgram } from '@/server/programExecutionPolicy';
import { scanRejection } from "@/server/execution";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function publicProgram<T extends PolicyProgram>(program: T | null) {
  if (!program) return null;
  const { executionPolicies, targets, ...rest } = program;
  void executionPolicies; void targets;
  return rest;
}

// GET /api/targets/[id] — one owned target with its scope, scan runs, and findings.
 async function handleGET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const query=new URL(req.url).searchParams;
  if(query.has('scanPage')||query.has('pageSize')){
    let input;try{input=paginationInput(new URLSearchParams({page:query.get('scanPage')??'1',pageSize:query.get('pageSize')??'25'}));}catch{return NextResponse.json({error:'Invalid scanPage or pageSize'},{status:400});}
    const result=await prisma.$transaction(async tx=>{
      const target=await tx.target.findFirst({where:{id,userId:session.user.id},include:{scope:true,program:{include:programPolicyInclude},scopeAsset:{select:{id:true,programId:true,normalizedValue:true,format:true,active:true}},discoveredFromAsset:{select:{id:true,programId:true,normalizedValue:true,format:true,active:true}},_count:{select:{findings:true}}}});
      if(!target)return null;
      const scanPage=paginationBounds(input,await tx.scanRun.count({where:{targetId:id}}));
      const scanRuns=await tx.scanRun.findMany({where:{targetId:id},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:scanPage.skip,take:scanPage.pageSize,include:{executionAttempts:executionSelect,jobOutbox:{select:dispatchSelect}}});
      return{...target,program:publicProgram(target.program),findingCount:target._count.findings,scanPage,scanRuns:scanRuns.map(withScanDispatch),scanRejection:scanRejection(target,'RECON')};
    },{isolationLevel:'RepeatableRead'});
    return NextResponse.json(result??{error:'Not found'},{status:result?200:404,headers:{'Cache-Control':'private, no-store'}});
  }
  const target = await prisma.target.findFirst({
    where: { id, userId: session.user.id },
    include: {
      scope: true,
      program: { include: programPolicyInclude },
      scopeAsset: { select: { id: true, programId: true, normalizedValue: true, format: true, active: true } },
      discoveredFromAsset: { select: { id: true, programId: true, normalizedValue: true, format: true, active: true } },
      scanRuns: { orderBy: [{createdAt:'desc'},{id:'desc'}], include: { executionAttempts: executionSelect, jobOutbox: { select: dispatchSelect } } },
      findings: { orderBy: [{createdAt:'desc'},{id:'desc'}] },
    },
  });

  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ...target, program: publicProgram(target.program), findings:target.findings.map(publicFinding), scanRuns: target.scanRuns.map(withScanDispatch), scanRejection: scanRejection(target, 'RECON') }, {headers:{'Cache-Control':'private, no-store'}});
}

export const GET = withApiBoundary(handleGET, ["id"]);
