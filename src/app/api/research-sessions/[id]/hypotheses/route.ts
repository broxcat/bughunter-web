import { auth } from "@/lib/auth";
import { HYPOTHESIS_STATUSES, type HypothesisStatus } from "@/lib/research/hypotheses";
import { listHypotheses } from "@/server/research/hypotheses";
import { hypothesisErrorResponse } from "@/server/research/hypothesisResponse";
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const query = new URL(req.url).searchParams, status = query.get("status"), page = query.get("page") ?? "1";
  if (status && !HYPOTHESIS_STATUSES.includes(status as HypothesisStatus) || !/^[1-9][0-9]?$/.test(page)) return Response.json({ error: "Invalid status or page" }, { status: 400 });
  try {
    const { id } = await params;
    return Response.json(await listHypotheses(id, session.user.id, status as HypothesisStatus || undefined, Number(page)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return hypothesisErrorResponse(error); }
}
