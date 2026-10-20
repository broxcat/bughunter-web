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

  const { id } = await params;

  const scope = await prisma.scope.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!scope) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.scope.update({
    where: { id: scope.id },
    data: { status: "APPROVED" },
  });

  return NextResponse.json(updated);
}
