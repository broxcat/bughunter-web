import { HypothesisSyncError } from "./hypotheses";
export function hypothesisErrorResponse(error: unknown) {
  if (error instanceof HypothesisSyncError) return Response.json({ code: error.code, error: error.message, issues: error.issues }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  // No Prisma diagnostics, raw file contents, secrets or filesystem paths.
  return Response.json({ code: "SYNC_UNAVAILABLE", error: "Research registry is unavailable. Please retry." }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
