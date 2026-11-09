import { z } from 'zod';
import { advanceCampaign, campaignPolicyBlocker } from '@/server/campaignOrchestrator';
import { foreignOrigin } from '@/lib/requestOrigin';
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { programCreateSchema } from "@/lib/bountyProgram";
import { paginationInput } from '@/lib/pagination';
import { programCollection } from '@/server/programCollection';
import { targetReviewSchema } from '@/lib/targetReview';
import { discoveryScopeRules, reviewedAssetData, reviewedPolicy, storeTestAccounts } from '@/server/targetReview';
import { ResearchError } from '@/server/research/workspace';

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  if(params.get('options')==='1')return NextResponse.json(await prisma.bountyProgram.findMany({where:{ownerId:session.user.id},select:{id:true,companyName:true},orderBy:[{companyName:'asc'},{id:'asc'}]}),{headers:{'Cache-Control':'private, no-store'}});
  if(params.has('page')||params.has('pageSize')){
    let input;try{input=paginationInput(params);}catch{return NextResponse.json({error:'Use a positive page and pageSize between 1 and 100'},{status:400});}
    return NextResponse.json(await programCollection(session.user.id,input),{headers:{'Cache-Control':'private, no-store'}});
  }
  return NextResponse.json(await prisma.bountyProgram.findMany({
    where: { ownerId: session.user.id }, orderBy: [{ companyName: "asc" },{id:'asc'}],
    include: { _count: { select: { scopeAssets: { where: { active: true } } } }, targets: { where: { active: true, contextOnly: false, userId: session.user.id }, orderBy: [{host:'asc'},{id:'asc'}] } },
  }), { headers: { 'Cache-Control': 'private, no-store' } });
}
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const parsed = programCreateSchema.extend({ targetReview: targetReviewSchema.optional(), startCampaign: z.boolean().optional() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  const { scopeHosts, targetReview, startCampaign, ...data } = parsed.data;
  if (startCampaign && !targetReview) return Response.json({ error: 'Review scope and policy before starting a campaign.' }, { status: 400 });
  data.scopeRules = [...new Set([...data.scopeRules, ...scopeHosts])];
  const ownerId = session.user.id;
  if (targetReview && (scopeHosts.length || data.scopeRules.length || data.outOfScope.length)) {
    return Response.json({ error: 'Use the reviewed scope without legacy scope fields.' }, { status: 400 });
  }
  if (targetReview?.scopeIn.some(asset => asset.type === 'OTHER')) {
    return Response.json({ error: 'Use a web asset type or keep the asset for reference.' }, { status: 400 });
  }
  if (targetReview) {
    try {
      const program = await prisma.$transaction(async tx => {
        const assets = reviewedAssetData(targetReview.scopeIn);
        const policy = reviewedPolicy(targetReview, { programUrl: data.programUrl ?? null, rulesOfEngagement: data.rulesOfEngagement ?? null, outOfScope: [] }, []);
        const created = await tx.bountyProgram.create({ data: {
          ...data, ownerId, scopeRules: discoveryScopeRules(assets), requiredUserAgent: policy.requiredUserAgent ?? '',
          executionPolicies: { create: { version: 1, policy } },
          ...(assets.length ? { scopeAssets: { createMany: { data: assets } } } : {}),
        } });
        await storeTestAccounts(tx, created, targetReview, policy);
        if (startCampaign) {
          const blocker = campaignPolicyBlocker({ ...created, executionPolicies: [{ version: 1, policy }] }) ??
            (assets.length ? null : 'Add at least one active Scope Asset before Recon');
          const source = targetReview.importSource;
          const matchedSource = source?.url === created.programUrl && source?.platform === created.platform ? source : undefined;
          await tx.targetCampaign.create({ data: { programId: created.id, state: blocker ? 'BLOCKED' : 'READY', reason: blocker,
            requestedAt: blocker ? null : new Date(), intervalMinutes: targetReview.campaignInterval ?? null,
            source: matchedSource, lastSyncAt: matchedSource ? new Date() : null } });
        }
        return created;
      });
      if (startCampaign) await advanceCampaign(ownerId, program.id).catch(() => {});
      return NextResponse.json(program, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
      return Response.json({ error: error instanceof ResearchError ? error.message : 'Target could not be saved. Try again.' },
        { status: error instanceof ResearchError ? error.status : 503 });
    }
  }
  const program = await prisma.$transaction(async tx => {
    const p = await tx.bountyProgram.create({ data: { ...data, requiredUserAgent: data.requiredUserAgent ?? "", ownerId } });
    for (const host of scopeHosts) {
      const scope = await tx.scope.create({ data: { userId: ownerId, hostPattern: host, programName: p.companyName, status: "APPROVED" } });
      await tx.target.create({ data: { userId: ownerId, programId: p.id, scopeId: scope.id, host, active: true } });
    }
    return p;
  });
  return NextResponse.json(program, { status: 201 });
}
