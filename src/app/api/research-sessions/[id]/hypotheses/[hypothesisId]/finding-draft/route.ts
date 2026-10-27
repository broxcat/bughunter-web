import { auth } from "@/lib/auth";
import { promoteHypothesis, promoteHypothesisSchema } from "@/server/research/promotion";
import { hypothesisErrorResponse } from "@/server/research/hypothesisResponse";
export async function POST(req: Request, { params }: { params: Promise<{ id: string; hypothesisId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const reader = req.body?.getReader(); let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const input = await Promise.race([
      (async () => {
        if (!reader) return null;
        const chunks: Uint8Array[] = []; let size = 0;
        while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 1024) return null; chunks.push(chunk.value); }
        try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); } catch { return null; }
      })(),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 2000); }),
    ]);
    const parsed = promoteHypothesisSchema.safeParse(input);
    if (!parsed.success) return Response.json({ code: "INVALID_INPUT", error: "Provide the reviewed revision and explicit human acknowledgement only" }, { status: 400 });
    const { id, hypothesisId } = await params;
    if (![id, hypothesisId].every(value => /^[A-Za-z0-9_-]{1,100}$/.test(value))) return Response.json({ error: "Not found" }, { status: 404 });
    const result = await promoteHypothesis(id, hypothesisId, session.user.id, parsed.data.expectedRevision);
    return Response.json(result, { status: result.created ? 201 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return hypothesisErrorResponse(error); }
  finally { clearTimeout(timer); await reader?.cancel().catch(() => {}); }
}
