import { routeIdSchema } from '@/lib/routeParams';
import { withApiBoundary } from '@/lib/apiBoundary';
import {Prisma} from '@prisma/client';
import {paginationInput} from '@/lib/pagination';
import {findingCollection} from '@/server/findingCollections';
import {safeFindingField,publicFinding} from '@/server/findingPrivacy';
import {foreignOrigin} from '@/lib/requestOrigin';
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { suggestCwe } from "@/lib/cwe";
import { loadOobHitsByToken } from "@/lib/oobHits";
import {
  cvssColumns,
  cvssVectorField,
  cweField,
  reportTextField,
} from "@/lib/findingClassification";

const createFindingSchema = z.object({
  targetId: routeIdSchema,
  scanRunId: routeIdSchema.optional(),
  title: z.string().trim().min(1, "title is required").max(300),
  vulnClass: z.string().trim().min(1).max(100).optional(),
  severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  description: z.string().trim().min(1).max(20000).optional(),
  location: z.string().trim().min(1).max(4096).optional(),
  evidence: z.string().trim().min(1).max(20000).optional(),
  cwe: cweField.optional(),
  cvssVector: cvssVectorField.optional(),
  impact: reportTextField.min(1).optional(),
  remediation: reportTextField.min(1).optional(),
});

// GET /api/findings?targetId=... — list findings for one owned target.
 async function handleGET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if(req.nextUrl.searchParams.has('page')||req.nextUrl.searchParams.has('pageSize')){
    let input;try{input=paginationInput(req.nextUrl.searchParams);}catch{return NextResponse.json({error:'Invalid page or pageSize'},{status:400});}
    const programId=req.nextUrl.searchParams.get('programId')||undefined,targetId=req.nextUrl.searchParams.get('targetId')||undefined;
    if(!programId&&!targetId)return NextResponse.json({error:"targetId is required"},{status:400});
    if(programId?!await prisma.bountyProgram.findFirst({where:{id:programId,ownerId:session.user.id},select:{id:true}}):targetId&&!await prisma.target.findFirst({where:{id:targetId,userId:session.user.id},select:{id:true}}))return NextResponse.json({error:'Not found'},{status:404});
    return NextResponse.json(await findingCollection(session.user.id,programId?{programId}:{targetId},input),{headers:{'Cache-Control':'private, no-store'}});
  }
  const targetId = req.nextUrl.searchParams.get("targetId");
  const programId = req.nextUrl.searchParams.get('programId');
  if (programId) {
    if (!await prisma.bountyProgram.findFirst({ where: { id: programId, ownerId: session.user.id }, select: { id: true } })) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json((await prisma.finding.findMany({ where: { target: { programId, userId: session.user.id } }, select: { id: true, title: true, targetId: true, reviewStatus: true, severity: true, lifecycle:true,lifecycleEvents:{where:{state:'VALIDATED'},take:1,select:{id:true}} }, orderBy: [{createdAt:'desc'},{id:'desc'}] })).map(publicFinding));
  }
  if (!targetId) {
    return NextResponse.json({ error: "targetId is required" }, { status: 400 });
  }

  const target = await prisma.target.findFirst({
    where: { id: targetId, userId: session.user.id },
    select: { id: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const findings = await prisma.finding.findMany({
    where: { targetId: target.id },
    include:{lifecycleEvents:{where:{state:'VALIDATED'},take:1,select:{id:true}}},
    orderBy: [{createdAt:"desc"},{id:"desc"}],
  });

  // Attach correlated out-of-band callbacks (Phase 5). A finding's oobToken
  // matches OobHit.token (0, 1, or many hits). One batched query for all tokens
  // on this page, then group in memory — no N+1.
  const tokens = findings
    .map((f) => f.oobToken)
    .filter((t): t is string => t !== null && t !== undefined);

  const hitsByToken = await loadOobHitsByToken(tokens);

  const withHits = findings.map((f) => ({
    ...publicFinding(f),
    oobHits: f.oobToken ? (hitsByToken.get(f.oobToken) ?? []) : [],
  }));

  return NextResponse.json(withHits);
}

// POST /api/findings — create a finding on an owned target. Starts UNVALIDATED;
// the evidence-review route decides its validation state.
 async function handlePOST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if(foreignOrigin(req))return NextResponse.json({error:'Forbidden'},{status:403});
  const body = await req.json().catch(() => null);
  const parsed = createFindingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const target = await prisma.target.findFirst({
    where: { id: parsed.data.targetId, userId: session.user.id },
    select: { id: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Target not found" }, { status: 404 });
  }

  // If a scanRun is referenced, it must belong to this target.
  if (parsed.data.scanRunId) {
    const run = await prisma.scanRun.findFirst({
      where: { id: parsed.data.scanRunId, targetId: target.id },
      select: { id: true },
    });
    if (!run) {
      return NextResponse.json(
        { error: "scanRun not found on this target" },
        { status: 400 },
      );
    }
  }

  const finding = await prisma.finding.create({
    data: {
      targetId: target.id,
      scanRunId: parsed.data.scanRunId,
      title: safeFindingField(parsed.data.title),
      vulnClass: safeFindingField(parsed.data.vulnClass),
      severity: parsed.data.severity ?? "INFO",
      description: safeFindingField(parsed.data.description),
      location: safeFindingField(parsed.data.location),
      evidence: safeFindingField(parsed.data.evidence),
      cwe: parsed.data.cwe ?? suggestCwe(parsed.data.vulnClass) ?? undefined,
      ...cvssColumns(parsed.data.cvssVector),
      impact: safeFindingField(parsed.data.impact),
      remediation: safeFindingField(parsed.data.remediation),
      gateStatus: "UNVALIDATED",
    },
   }).catch(error=>{if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2003')return null;throw error;});
  if(!finding){
    const present=await prisma.target.count({where:{id:target.id,userId:session.user.id}});
    return NextResponse.json({error:present?'Referenced scanRun is no longer available':'Target not found'},{status:present?400:404});
  }

  return NextResponse.json(publicFinding(finding), { status: 201 });
}

export const GET = withApiBoundary(handleGET, []);
export const POST = withApiBoundary(handlePOST, []);
