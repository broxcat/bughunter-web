import { isDeepStrictEqual } from 'node:util';
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { currentPolicySelection } from '@/server/programExecutionPolicy';
import { executionPolicySchema } from '@/lib/programExecutionPolicy';
import { programUpdateSchema } from "@/lib/bountyProgram";
import { deleteProgram } from '@/server/programDeletion';
import { ResearchError } from '@/server/research/workspace';
import { targetIdentity } from '@/lib/research/terminal';
import { foreignOrigin } from '@/lib/requestOrigin';

type Params = { params: Promise<{ id: string }> };
export async function GET(_req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const program = await prisma.bountyProgram.findFirst({ where: { id, ownerId: session.user.id }, include: { executionPolicies: currentPolicySelection, targets: { where: { active: true, contextOnly: false, userId: session.user.id }, orderBy: [{host:'asc'},{id:'asc'}] } } });
  return program ? NextResponse.json(program) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
export async function PATCH(req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const parsed = programUpdateSchema.extend({ executionPolicy: executionPolicySchema.optional() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  const program = await prisma.bountyProgram.findFirst({ where: { id, ownerId: session.user.id, deletingAt: null } });
  if (!program) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{id:string}[]>`SELECT id FROM "BountyProgram" WHERE id=${id} AND "ownerId"=${session.user.id} AND "deletingAt" IS NULL FOR UPDATE`;
    if (!rows.length) return Response.json({ error: 'Target unavailable' }, { status: 409 });
    // The preflight read establishes existence only. Another policy writer can
    // commit before this lock is acquired; derive removals from the locked row.
    const current = await tx.bountyProgram.findUniqueOrThrow({ where: { id }, select: { scopeRules: true, updatedAt: true, programUrl: true, rulesOfEngagement: true, executionPolicies: { ...currentPolicySelection, select: { version: true, policy: true } } } });
    if(parsed.data.expectedUpdatedAt&&current.updatedAt.toISOString()!==parsed.data.expectedUpdatedAt)return Response.json({error:'Target settings changed. Reload before saving.'},{status:409});
    const { executionPolicy, ...changes } = parsed.data;
    delete changes.expectedUpdatedAt;
    if (executionPolicy && (executionPolicy.sourceSnapshot.rules !== (changes.rulesOfEngagement === undefined ? current.rulesOfEngagement?.trim() ?? '' : changes.rulesOfEngagement ?? '') ||
        executionPolicy.sourceSnapshot.url !== (changes.programUrl === undefined ? current.programUrl : changes.programUrl))) {
      return Response.json({ error: 'The execution policy source must match the current program URL and rules.' }, { status: 400 });
    }
    if (parsed.data.scopeRules) {
      const removed = current.scopeRules.filter(rule => !parsed.data.scopeRules!.includes(rule));
      const assets = await tx.scopeAsset.findMany({ where: { programId: id, normalizedValue: { in: removed }, active: true }, select: { id: true } });
      if (await tx.scanRun.count({ where: { scopeAssetId: { in: assets.map(a => a.id) }, status: { in: ['QUEUED', 'RUNNING'] } } })) return Response.json({ error: 'Stop active Recon before removing its scope rules' }, { status: 409 });
      await tx.scopeAsset.updateMany({ where: { id: { in: assets.map(a => a.id) } }, data: { active: false } });
    }
    return NextResponse.json(await tx.bountyProgram.update({ where: { id }, data: {
      ...changes,
      ...(executionPolicy && !isDeepStrictEqual(executionPolicy, current.executionPolicies[0]?.policy) ? { executionPolicies: { create: { version: (current.executionPolicies[0]?.version ?? 0) + 1, policy: executionPolicy } } } : {}),
      updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime() + 1)),
    } }));
  });
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (foreignOrigin(_req)) return Response.json({error:'Forbidden'},{status:403});
  const { id } = await params;
  if (!targetIdentity.safeParse(id).success) return Response.json({ error: 'Invalid target' }, { status: 400 });
  try { await deleteProgram(session.user.id, id); return Response.json({ deleted: true }); }
  catch (e) { return Response.json({ error: e instanceof ResearchError ? e.message : 'Deletion incomplete; target remains blocked. Retry deletion.' }, { status: e instanceof ResearchError ? e.status : 503 }); }
}
