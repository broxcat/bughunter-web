import {Prisma} from '@prisma/client';
import { foreignOrigin } from '@/lib/requestOrigin';
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// POST /api/scopes/[id]/approve — the user attests authorization for this scope.
// Only the owner may approve, and only their own scope.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (foreignOrigin(_req)) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;

  const scope = await prisma.scope.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!scope) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.scope.update({
    where: { id: scope.id, userId: session.user.id },
    data: { status: "APPROVED" },
   }).catch(error=>{
    if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2025')return null;
    throw error;
  });
  if(!updated)return NextResponse.json({error:'Not found'},{status:404});

  return NextResponse.json(updated);
}
