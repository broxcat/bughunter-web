import { withApiBoundary } from '@/lib/apiBoundary';
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { connectionInputSchema, normalizeCookies } from "@/lib/targetAuth";
import { loadTargetExecution } from "@/server/execution";
import { testStoredConnection } from "@/server/credentials/connection";
import { foreignOrigin } from '@/lib/requestOrigin';

export const runtime = "nodejs";
/** Test connection also saves encrypted inputs; only status metadata is returned. */
 async function handlePOST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (foreignOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  if (!await prisma.target.findFirst({ where: { id, userId: session.user.id }, select: { id: true } })) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid authentication input" }, { status: 400 });
  try { await loadTargetExecution(id); }
  catch { return NextResponse.json({ error: "An active in-scope host and configured User-Agent are required" }, { status: 400 }); }
  let credentialId: string;
  if (typeof body.credentialId === "string") {
    const row = await prisma.targetCredential.findFirst({ where: { targetId: id, id: body.credentialId }, select: { id: true } });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    credentialId = row.id;
  } else {
    const parsed = connectionInputSchema.safeParse({ ...body, mode: body.mode ?? (body.cookies !== undefined ? "COOKIES" : "EMAIL_PASSWORD"), username: body.username ?? body.email });
    if (!parsed.success) return NextResponse.json({ error: "Provide username/password, a session cookie or a bearer token" }, { status: 400 });
    let cookies: Record<string, string> | undefined;
    if (parsed.data.mode === "COOKIES") {
      try { cookies = normalizeCookies(parsed.data.cookies); }
      catch { return NextResponse.json({ error: "Invalid session cookie" }, { status: 400 }); }
    }
    const previous = await prisma.targetCredential.findMany({ where: { targetId: id }, select: { purpose: true } });
    const purpose = !previous.some(c => c.purpose === "ACCOUNT_A") ? "ACCOUNT_A" : !previous.some(c => c.purpose === "ACCOUNT_B") ? "ACCOUNT_B" : "OTHER";
    const created = await prisma.targetCredential.create({ data: {
      targetId: id, label: `Account ${previous.length + 1}`, mode: parsed.data.mode, purpose,
      ...(parsed.data.mode === 'BEARER' ? { headerCipher: encryptSecret(parsed.data.bearerToken) } : parsed.data.mode === "COOKIES" ? { cookiesCipher: encryptSecret(JSON.stringify(cookies)) } : { emailCipher: encryptSecret(parsed.data.username), passwordCipher: encryptSecret(parsed.data.password) }),
    } });
    credentialId = created.id;
  }
  try {
    const result = await testStoredConnection(id, credentialId, req.signal);
    return NextResponse.json({ ...result, ok: result.status === "VALID" });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error && e.message === "CONNECTION_RATE_LIMIT" ? "Please wait before testing this connection again" : "Connection check unavailable" }, { status: e instanceof Error && e.message === "CONNECTION_RATE_LIMIT" ? 429 : 400 });
  }
}

export const POST = withApiBoundary(handlePOST, ["id"]);
