import { auth } from "@/lib/auth";
import { z } from "zod";
import { ensureTargetConsole } from "@/server/research/consoleWorkspace";
import { ResearchError } from "@/server/research/workspace";

const input = z.strictObject({
  targetIds: z.array(z.string().min(1).max(100)).min(1).max(20),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(process.env.AUTH_URL!).origin) return Response.json({ error: "Forbidden" }, { status: 403 });

  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Select between 1 and 20 hosts." }, { status: 400 });

  const created: Array<{ targetId: string; sessionId: string }> = [];
  for (const targetId of [...new Set(parsed.data.targetIds)]) {
    try {
      const { session: research } = await ensureTargetConsole(session.user.id, targetId);
      created.push({ targetId, sessionId: research.id });
    } catch (error) {
      return Response.json({
        error: error instanceof ResearchError ? error.message : "Unable to create research console",
        created,
      }, { status: error instanceof ResearchError ? error.status : 503 });
    }
  }

  return Response.json({ created }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
