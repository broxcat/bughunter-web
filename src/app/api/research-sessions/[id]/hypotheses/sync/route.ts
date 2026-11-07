import { foreignOrigin } from '@/lib/requestOrigin';
import { auth } from "@/lib/auth";
import { syncHypotheses } from "@/server/research/hypotheses";
import { hypothesisErrorResponse } from "@/server/research/hypothesisResponse";
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  // This action accepts no payload, filesystem path or command.
  if (req.body) {
    // Next may expose an empty stream for a POST without payload. Consume at
    // most its first non-empty chunk, never buffer or parse client JSON.
    const reader = req.body.getReader();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const nonempty = (async () => {
        while (true) { const chunk = await reader.read(); if (chunk.done) return false; if (chunk.value.byteLength) return true; }
      })();
      const hasBody = await Promise.race([nonempty, new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(true), 2000); })]);
      if (hasBody) return Response.json({ error: "Sync accepts no request body" }, { status: 400 });
    } finally { clearTimeout(timer); await reader.cancel().catch(() => {}); }
  }
  try {
    const { id } = await params;
    return Response.json(await syncHypotheses(id, session.user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return hypothesisErrorResponse(error); }
}
