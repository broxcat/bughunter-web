import { auth } from "@/lib/auth";
import { foreignOrigin } from "@/lib/requestOrigin";
import { addDiscoveredScope } from "@/server/recon/discoveredScope";
import { assetError } from "@/server/scopeAssets";
import { z } from "zod";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (foreignOrigin(req))
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const input = z
    .object({ hosts: z.array(z.string().max(253)).min(1).max(1000) })
    .safeParse(await req.json().catch(() => null));
  if (!input.success)
    return Response.json({ error: "Select discovered hosts" }, { status: 400 });
  try {
    await addDiscoveredScope(userId, (await params).id, input.data.hosts);
    return Response.json({ added: true });
  } catch (e) {
    return assetError(e);
  }
}
