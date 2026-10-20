import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/targets/[id] — one owned target with its scope, scan runs, and findings.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const target = await prisma.target.findFirst({
    where: { id, userId: session.user.id },
    include: {
      scope: true,
      scanRuns: { orderBy: { createdAt: "desc" } },
      findings: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(target);
}
