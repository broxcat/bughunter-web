import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { scanQueue } from "@/server/queue/scanQueue";

const createRunSchema = z.object({
  targetId: z.string().trim().min(1, "targetId is required"),
  type: z.enum(["RECON", "HUNT", "VALIDATE"]),
});

// GET /api/scan-runs?targetId=... — list runs for one owned target, newest first.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const targetId = req.nextUrl.searchParams.get("targetId");
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

  const runs = await prisma.scanRun.findMany({
    where: { targetId: target.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(runs);
}

// POST /api/scan-runs — enqueue a scan. Re-verifies the target is owned and its
// scope is APPROVED (authorization attestation), creates a QUEUED ScanRun, hands
// it to the BullMQ queue, and records the returned job id.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createRunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const target = await prisma.target.findFirst({
    where: { id: parsed.data.targetId, userId: session.user.id },
    include: { scope: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (target.scope.status !== "APPROVED") {
    return NextResponse.json(
      { error: "Target's scope is not APPROVED; refusing to scan" },
      { status: 400 },
    );
  }

  const run = await prisma.scanRun.create({
    data: {
      targetId: target.id,
      type: parsed.data.type,
      status: "QUEUED",
    },
  });

  const job = await scanQueue.add("scan", {
    scanRunId: run.id,
    targetId: target.id,
    type: parsed.data.type,
  });

  const updated = await prisma.scanRun.update({
    where: { id: run.id },
    data: { jobId: job.id ?? null },
  });

  return NextResponse.json(updated, { status: 201 });
}
