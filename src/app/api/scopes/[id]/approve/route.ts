import {Prisma} from '@prisma/client';
import { z } from 'zod';
import { foreignOrigin } from '@/lib/requestOrigin';
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from '@/lib/logger';
import { routeId } from '@/lib/routeParams';
import { assertPublicScopeValues, scopeAdmissionResponse } from '@/server/scopeAdmission';

// M2: approval is an explicit, recorded attestation, never a bare state flip.
const approvalSchema = z.strictObject({
  justification: z.string().trim().min(20, 'Explain the authorization (program URL, engagement reference) in at least 20 characters').max(2000),
  attestation: z.literal(true, 'Confirm that you are authorized to test this scope'),
});

// POST /api/scopes/[id]/approve — the owner attests authorization for this scope.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const id = routeId((await params).id);
  if (!id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = approvalSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues.map(issue => issue.message).join('; ') }, { status: 400 });

  const scope = await prisma.scope.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!scope) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try { await assertPublicScopeValues([scope.hostPattern]); }
  catch (error) { const refused = scopeAdmissionResponse(error); if (refused) return refused; throw error; }

  const updated = await prisma.scope.update({
    where: { id: scope.id, userId: session.user.id },
    data: { status: "APPROVED", justification: body.data.justification },
   }).catch(error=>{
    if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2025')return null;
    throw error;
  });
  if(!updated)return NextResponse.json({error:'Not found'},{status:404});
  // Audit trail: who attested which scope, never the justification text itself.
  logger.info({ audit: 'scope.approved', scopeId: updated.id, userId: session.user.id, previousStatus: scope.status }, 'scope authorization attested');

  return NextResponse.json(updated);
}
