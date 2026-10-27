import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ownedResearch, researchRoot } from "@/server/research/sessions";
import { readResearchZip } from "@/server/research/workspace";
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const research = await prisma.researchSession.findFirst({ where: { id, ...ownedResearch(session.user.id) }, select: { workspaceId: true, status: true, exportSha256: true } });
  if (!research) return Response.json({ error: "Not found" }, { status: 404 });
  if (research.status !== "READY" || !research.exportSha256) return Response.json({ error: "Workspace is not ready" }, { status: 409 });
  try {
    const zip = await readResearchZip(researchRoot(), research.workspaceId, research.exportSha256);
    return new Response(new Uint8Array(zip), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="bughunter-research-${research.workspaceId}.zip"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return Response.json({ error: "Export unavailable or integrity check failed" }, { status: 409 });
  }
}
