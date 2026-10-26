import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const run = await prisma.scanRun.findFirst({ where: { id, type: "HUNT", target: { userId: session.user.id, OR: [{ program: null }, { program: { ownerId: session.user.id } }] } }, select: { id: true, status: true, huntReport: true, huntSnapshot: true, createdAt: true, target: { select: { id: true, host: true, program: { select: { companyName: true } } } } } });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(run, { headers: { "Cache-Control": "no-store" } });
}
