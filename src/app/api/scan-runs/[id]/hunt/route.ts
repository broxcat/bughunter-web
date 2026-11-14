import { withApiBoundary } from '@/lib/apiBoundary';
import { executionSelect } from "@/server/queue/executionAttempts";
import { withScanDispatch } from "@/lib/scanDispatch";
import { dispatchSelect } from "@/server/queue/scanJobPublisher";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
 async function handleGET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const run = await prisma.scanRun.findFirst({ where: { id, type: "HUNT", target: { userId: session.user.id, OR: [{ program: null }, { program: { ownerId: session.user.id } }] } }, select: { cancelRequestedAt: true, executionAttempts: executionSelect, jobOutbox: { select: dispatchSelect }, id: true, status: true, outcome: true, error: true, huntReport: true, huntSnapshot: true, createdAt: true, target: { select: { id: true, host: true, program: { select: { companyName: true } } } } } });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(withScanDispatch(run), { headers: { "Cache-Control": "no-store" } });
}

export const GET = withApiBoundary(handleGET, ["id"]);
