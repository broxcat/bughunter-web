import { withApiBoundary } from '@/lib/apiBoundary';
import {paginationInput} from '@/lib/pagination';
import {reportCollection} from '@/server/findingCollections';
import {publicFinding,safeFindingText} from '@/server/findingPrivacy';
import {Prisma} from '@prisma/client';
import {foreignOrigin} from '@/lib/requestOrigin';
import {lifecycleReportEligible} from '@/lib/findingLifecycle';
import { findingReviewStatus } from "@/lib/evidenceReview";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadOobHitsByToken } from "@/lib/oobHits";
import { renderReport,capturedFindingAssessment, type ReportFinding } from "@/lib/reportTemplates";

const createReportSchema = z.object({
  title: z.string().trim().min(1, "title is required").max(300),
  platform: z.enum([
    "HACKERONE",
    "BUGCROWD",
    "INTIGRITI",
    "YESWEHACK",
    "IMMUNEFI",
    "GENERIC",
  ]),
  findingIds: z.array(z.string().trim().min(1).max(150)).min(1, "at least one finding is required").max(100),
});

// GET /api/reports — list the user's reports.
 async function handleGET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if(req.nextUrl.searchParams.has('page')||req.nextUrl.searchParams.has('pageSize')){
    let input;try{input=paginationInput(req.nextUrl.searchParams);}catch{return NextResponse.json({error:'Invalid page or pageSize'},{status:400});}
    const programId=req.nextUrl.searchParams.get('programId')||undefined,targetId=req.nextUrl.searchParams.get('targetId')||undefined;

    if(programId?!await prisma.bountyProgram.findFirst({where:{id:programId,ownerId:session.user.id},select:{id:true}}):targetId&&!await prisma.target.findFirst({where:{id:targetId,userId:session.user.id},select:{id:true}}))return NextResponse.json({error:'Not found'},{status:404});
    return NextResponse.json(await reportCollection(session.user.id,programId?{programId}:{targetId},input),{headers:{'Cache-Control':'private, no-store'}});
  }
  const targetId = req.nextUrl.searchParams.get("targetId");
  const programId=req.nextUrl.searchParams.get('programId');
  if(programId){
    if(!await prisma.bountyProgram.findFirst({where:{id:programId,ownerId:session.user.id},select:{id:true}}))return NextResponse.json({error:'Not found'},{status:404});
    const rows=await prisma.report.findMany({where:{userId:session.user.id,items:{some:{finding:{target:{programId,userId:session.user.id}}}}},include:{items:{select:{finding:{select:{targetId:true}}}}},orderBy:[{createdAt:'desc'},{id:'desc'}]});
    return NextResponse.json(rows.map(r=>({...r,markdown:r.markdown?safeFindingText(r.markdown):r.markdown,title:safeFindingText(r.title),evidenceTargetIds:[...new Set(r.items.map(i=>i.finding.targetId))]})));
  }
  if (targetId && !await prisma.target.findFirst({ where: { id: targetId, userId: session.user.id }, select: { id: true } })) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const reports = await prisma.report.findMany({
    where: { userId: session.user.id, ...(targetId ? { targetId } : {}) },
    orderBy: [{createdAt:"desc"},{id:"desc"}],
  });

  return NextResponse.json(reports.map(r=>({...r,title:safeFindingText(r.title),markdown:r.markdown?safeFindingText(r.markdown):r.markdown})));
}

// POST /api/reports — NON-NEGOTIABLE: a report may include ONLY findings whose
// review status CONFIRMED and that the user owns. Any violation rejects the
// whole request (400); nothing is written.
 async function handlePOST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if(foreignOrigin(req))return NextResponse.json({error:'Forbidden'},{status:403});
  const body = await req.json().catch(() => null);
  const parsed = createReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const requestedIds = Array.from(new Set(parsed.data.findingIds));

  return prisma.$transaction(async tx=>{
  // Shared row locks keep review/lifecycle eligibility stable until the Report commits.
  await tx.$queryRaw(Prisma.sql`SELECT f.id FROM "Finding" f JOIN "Target" t ON f."targetId"=t.id WHERE f.id IN (${Prisma.join(requestedIds)}) AND t."userId"=${session.user.id} ORDER BY f.id FOR SHARE OF f`);
  // Fetch only the user's own findings among those requested.
  const findings = await tx.finding.findMany({
    where: { id: { in: requestedIds }, target: { userId: session.user.id } },
    include:{lifecycleEvents:{where:{state:'VALIDATED'},take:1,select:{id:true}},retests:{orderBy:[{createdAt:'desc'},{id:'desc'}],take:100,include:{result:true}},vaultEvidence:{include:{evidence:true}},scanRun:{select:{assessmentModeSnapshot:true}},researchPromotion:{select:{hypothesis:{select:{session:{select:{authorizationSnapshot:true}}}}}}},
  });

  // Every requested id must resolve to an owned finding.
  if (findings.length !== requestedIds.length) {
    return NextResponse.json(
      { error: "One or more findings were not found or are not owned by you" },
      { status: 400 },
    );
  }

  // Every included finding must have confirmed evidence.
  const notPassed = findings.filter((f) => findingReviewStatus(f) !== "CONFIRMED"||!lifecycleReportEligible(f.lifecycle)||(f.lifecycle!=null&&!f.lifecycleEvents?.length));
  if (notPassed.length > 0) {
    return NextResponse.json(
      {
        error: "A report may only include confirmed findings",
        offending: notPassed.map((f) => ({ id: f.id, reviewStatus: findingReviewStatus(f) })),
      },
      { status: 400 },
    );
  }

  // SSRF proof of concept includes the correlated out-of-band callbacks.
  const hitsByToken = await loadOobHitsByToken(
    findings.map((f) => f.oobToken).filter((t): t is string => !!t),
  );

  // Render in the requested-id order for a stable report.
  const byId = new Map(findings.map((f) => [f.id, f]));
  const ordered: ReportFinding[] = requestedIds.map((fid) => {
    const f = publicFinding(byId.get(fid)!);
    return {
      ...capturedFindingAssessment(f),
      lifecycle:f.lifecycle??null,
      retests:f.retests?.map(r=>({requestedAt:r.createdAt.toISOString(),originalEvidenceIds:r.originalEvidenceIds,outcome:r.result?.outcome??'PENDING',performedAt:r.result?.performedAt.toISOString()??null,newEvidenceIds:r.result?.evidenceIds??[],conclusion:r.result?.conclusion??null})),
      vaultEvidence:f.vaultEvidence?.map(link=>({id:link.evidence.id,kind:link.evidence.kind,role:link.role,description:link.evidence.description,contentSha256:link.evidence.contentSha256})),
      title: f.title,
      vulnClass: f.vulnClass,
      severity: f.severity,
      description: f.description,
      evidence: f.evidence,
      location: f.location,
      cwe: f.cwe,
      cvssVector: f.cvssVector,
      cvssScore: f.cvssScore,
      impact: f.impact,
      remediation: f.remediation,
      oobHits: f.oobToken ? (hitsByToken.get(f.oobToken) ?? []) : [],
    };
  });

  const markdown = renderReport(parsed.data.platform, {
    title: safeFindingText(parsed.data.title),
    findings: ordered,
  });

  // Denormalized link to the report's target. The findings are all owned by the
  // user and, in the per-target report flow, all share one target — so link it
  // when unambiguous, otherwise leave null.
  const targetIds = new Set(findings.map((f) => f.targetId));
  const targetId = targetIds.size === 1 ? findings[0].targetId : null;

  const reportId=crypto.randomUUID();
  const report = await tx.report.create({
    data: {
      id:reportId,
      userId: session.user.id,
      targetId,
      title: safeFindingText(parsed.data.title),
      platform: parsed.data.platform,
      markdown,
      vaultEvidence:{create:[...new Set(findings.flatMap(f=>(f.vaultEvidence??[]).map(link=>link.evidenceId)))].map(evidenceId=>({evidenceId,reportReferenceId:reportId}))},
      items: {
        create: requestedIds.map((findingId) => ({ findingId })),
      },
    },
    include: { items: true },
  });

  return NextResponse.json(report, { status: 201 });
  },{timeout:20000});
}

export const GET = withApiBoundary(handleGET, []);
export const POST = withApiBoundary(handlePOST, []);
