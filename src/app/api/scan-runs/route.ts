import { routeIdSchema } from '@/lib/routeParams';
import { withApiBoundary } from '@/lib/apiBoundary';
import { foreignOrigin } from '@/lib/requestOrigin';
import { executionSelect } from "@/server/queue/executionAttempts";
import { programPolicyInclude } from '@/server/programExecutionPolicy';
import { scanRejection } from "@/server/execution";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { publishScanJob, dispatchSelect } from "@/server/queue/scanJobPublisher";
import { createScanRequest, findScanRequest, ScanRequestConflict, ScanRequestNotFound, ScanRequestQuotaExceeded } from "@/server/queue/scanRequest";
import { withScanDispatch } from "@/lib/scanDispatch";
import { rateLimit } from "@/lib/rateLimit";
import { logger } from "@/lib/logger";
import { RATE_LIMIT_POLICIES } from "@/lib/abusePolicy";
import { backfillProgramAssets, lockOwnedProgram } from '@/server/scopeAssets';
import { ResearchError } from '@/server/research/workspace';

const createRunSchema = z.object({
  targetId: routeIdSchema,
  type: z.literal("RECON"),
});

// GET /api/scan-runs?targetId=... — list runs for one owned target, newest first.
 async function handleGET(req: NextRequest) {
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
    orderBy: [{createdAt:'desc'},{id:'desc'}],
    include: { executionAttempts: executionSelect, jobOutbox: { select: dispatchSelect } },
  });

  return NextResponse.json(runs.map(withScanDispatch));
}

// Accept ScanRun + publication intent in PostgreSQL before contacting Redis.
// Redis failures are retryable delivery delays, never lost/failed scan executions.
 async function handlePOST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (body?.type === "HUNT") return NextResponse.json({ error: "Legacy HUNT is retired. Use the automated Research stage instead." }, { status: 410 });
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

  const key = req.headers.get("Idempotency-Key");
  if (key !== null && !/^[A-Za-z0-9._~-]{1,128}$/.test(key)) {
    return NextResponse.json({ error: "Invalid Idempotency-Key: use 1–128 ASCII letters, digits, '.', '_', '~' or '-'." }, { status: 400 });
  }
  const respond = async (run: Awaited<ReturnType<typeof createScanRequest>>) => {
    const { dispatch } = await publishScanJob(run.id);
    // A worker may already have started. If DB reads fail after acceptance, keep
    // the committed response rather than falsely reporting that creation failed.
    const fresh = await prisma.scanRun.findUnique({ where: { id: run.id }, include: { executionAttempts: executionSelect, jobOutbox: { select: dispatchSelect } } }).catch(() => null);
    const confirmedDispatch = fresh?.jobOutbox?.status ?? dispatch;
    return NextResponse.json({ ...withScanDispatch(fresh ?? run), jobId: fresh?.jobId ?? (confirmedDispatch === "PUBLISHED" ? run.id : run.jobId), dispatch: confirmedDispatch }, { status: confirmedDispatch === "PUBLISHED" ? 201 : 202 });
  };
  try {
    const existing = await findScanRequest(session.user.id, key, parsed.data);
    if (existing) return await respond(existing);

    // Throttle new requests; an idempotent replay does not consume the quota.
    const policy = RATE_LIMIT_POLICIES.scanUser;
    const limit = await rateLimit(
      `rl:scan-runs:${session.user.id}`,
      policy.limit,
      policy.windowSec,
    );
    if (limit.status === "BLOCKED") {
      return NextResponse.json(
        { error: "Too many scan runs. Please try again later." },
        { status: 429, headers: { "Retry-After": String(limit.resetSec) } },
      );
    }
    if (limit.status === "UNAVAILABLE") {
      logger.warn({ operation: "scan-create", userId: session.user.id, policy: "POSTGRES_QUOTA" }, "scan anti-abuse using durable database quota");
    }

    const target = await prisma.target.findFirst({
      where: { id: parsed.data.targetId, userId: session.user.id },
      include: { scope: true, program: { include: programPolicyInclude }, scopeAsset: true },
    });
    if (!target) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const rejection = scanRejection(target, 'RECON');
    if (rejection) return NextResponse.json({ error: rejection }, { status: 400 });

    let scopeAssetId = target.scopeAssetId;
    if (!scopeAssetId && target.program?.id && !target.contextOnly) {
      scopeAssetId = await prisma.$transaction(async tx => { await lockOwnedProgram(tx, session.user.id!, target.program!.id); await backfillProgramAssets(tx, target.program!.id, session.user.id!); return (await tx.target.findUniqueOrThrow({ where: { id: target.id }, select: { scopeAssetId: true } })).scopeAssetId; });
    }
    if (!scopeAssetId) return NextResponse.json({ error: 'Start Recon from the Target; a new run requires an explicit active Scope Asset.', targetId: target.programId }, { status: 410 });
    const run = await createScanRequest(session.user.id, { ...parsed.data, ...(scopeAssetId ? { scopeAssetId } : {}) }, key);
    return await respond(run);
  } catch (err) {
    if (err instanceof ResearchError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof ScanRequestQuotaExceeded) return NextResponse.json({ error: err.message }, { status: 429, headers: { "Retry-After": String(err.retrySec) } });
    if (err instanceof ScanRequestConflict) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof ScanRequestNotFound) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Do not log connection strings or database error details.
    logger.error({ userId: session.user.id, code: "SCAN_REQUEST_DATABASE_ERROR" }, "scan-runs: failed to accept scan");
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}

export const GET = withApiBoundary(handleGET, []);
export const POST = withApiBoundary(handlePOST, []);
