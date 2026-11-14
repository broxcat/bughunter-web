import { withApiBoundary } from '@/lib/apiBoundary';
import { foreignOrigin } from '@/lib/requestOrigin';
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requestScanCancellation } from "@/server/queue/scanCancellation";
import { logger } from "@/lib/logger";

 async function handlePOST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (foreignOrigin(_req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  try {
    const result = await requestScanCancellation(id, session.user.id);
    if (result.kind === "NOT_FOUND") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (result.kind === "TERMINAL") return NextResponse.json({ error: "Scan is already terminal" }, { status: 409 });
    return NextResponse.json({ id, status: result.run.status, cancelRequestedAt: result.run.cancelRequestedAt, cancellation: result.kind === "CANCELLED" ? "COMPLETED" : "REQUESTED" }, { status: result.kind === "CANCELLED" ? 200 : 202 });
  } catch {
    logger.warn({ scanRunId: id, reason: "CANCELLATION_DATABASE_UNAVAILABLE" }, "scan cancellation request failed");
    return NextResponse.json({ error: "Unable to request cancellation. Please try again." }, { status: 500 });
  }
}

export const POST = withApiBoundary(handlePOST, ["id"]);
