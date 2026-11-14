import { withApiBoundary } from '@/lib/apiBoundary';
import { auth } from "@/lib/auth";
import { hypothesisDetail } from "@/server/research/hypotheses";
import { hypothesisErrorResponse } from "@/server/research/hypothesisResponse";
 async function handleGET(req: Request, { params }: { params: Promise<{ id: string; hypothesisId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const page = new URL(req.url).searchParams.get("revisionPage") ?? "1";
  if (!/^[1-9][0-9]{0,3}$/.test(page)) return Response.json({ error: "Invalid revisionPage" }, { status: 400 });
  try {
    const { id, hypothesisId } = await params;
    return Response.json(await hypothesisDetail(id, hypothesisId, session.user.id, Number(page)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return hypothesisErrorResponse(error); }
}

export const GET = withApiBoundary(handleGET, ["id","hypothesisId"]);
