import { withApiBoundary } from '@/lib/apiBoundary';
import { auth } from "@/lib/auth";
 async function handleGET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ error: "Legacy Hunt readiness is retired. Use Research." }, { status: 410 });
}

export const GET = withApiBoundary(handleGET, ["id"]);
