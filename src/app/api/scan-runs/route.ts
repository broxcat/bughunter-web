import { APPROVABLE_HUNT_TECHNIQUES } from "@/lib/hunt/approvals";
import { resolveHuntFamilies } from "@/lib/hunt/policy";
import { HUNT_TECHNIQUES } from "@/lib/hunt/catalogData";
import { scanRejection } from "@/server/execution";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { scanQueue } from "@/server/queue/scanQueue";
import { rateLimit } from "@/lib/rateLimit";
import { logger } from "@/lib/logger";

const createRunSchema = z.object({
  approvedTechniques: z.array(z.enum(APPROVABLE_HUNT_TECHNIQUES)).max(4).default([]),
  approveBoundedTiming: z.literal(true).optional(),
  targetId: z.string().trim().min(1, "targetId is required"),
  type: z.enum(["RECON", "HUNT"]),
});

// Per-user cap on how many scan-runs can be enqueued. The worker runs
// concurrency:1 so execution is serialized, but that doesn't stop a client from
// flooding the queue with thousands of QUEUED jobs — this does.
const SCAN_RUN_LIMIT = 20; // per user
const SCAN_RUN_WINDOW_SEC = 60 * 60; // per hour

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
  if (body?.type === "VALIDATE") {
    return NextResponse.json({ error: "VALIDATE scans are not supported: the validation engine is not implemented." }, { status: 400 });
  }
  const parsed = createRunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Throttle enqueues per user BEFORE touching the queue, so a client can't
  // flood it with jobs. Fails open if Redis is down (see rateLimit).
  const { allowed, resetSec } = await rateLimit(
    `rl:scan-runs:${session.user.id}`,
    SCAN_RUN_LIMIT,
    SCAN_RUN_WINDOW_SEC,
  );
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many scan runs. Please try again later." },
      { status: 429, headers: { "Retry-After": String(resetSec) } },
    );
  }

  try {
    const target = await prisma.target.findFirst({
      where: { id: parsed.data.targetId, userId: session.user.id },
      include: { scope: true, program: true },
    });
    if (!target) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const rejection = scanRejection(target);
    if (rejection) return NextResponse.json({ error: rejection }, { status: 400 });

    if (parsed.data.approvedTechniques.length) {
      const selected = new Set(resolveHuntFamilies(target.program!).filter(f => f.selected).map(f => f.family));
      if (parsed.data.type !== "HUNT" || parsed.data.approveBoundedTiming !== true || parsed.data.approvedTechniques.some(id => !selected.has(HUNT_TECHNIQUES.find(t => t.id === id)?.family ?? ""))) return NextResponse.json({ error: "Explicit approval is required for selected bounded timing techniques" }, { status: 400 });
    }
    const run = await prisma.scanRun.create({
      data: {
        targetId: target.id,
        type: parsed.data.type,
        status: "QUEUED",
        approvedHuntTechniques: parsed.data.approvedTechniques,
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
  } catch (err) {
    // Generic client message; real error (DB/queue) logged server-side only.
    logger.error({ err, userId: session.user.id }, "scan-runs: failed to enqueue scan");
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
