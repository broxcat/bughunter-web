import { auth } from "@/lib/auth";
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ error: "Legacy Hunt readiness is retired. Use Research." }, { status: 410 });
}
