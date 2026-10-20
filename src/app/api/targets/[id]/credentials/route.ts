import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";

// Per-target credentials — session cookies / bearer token FOR THE SCANNED
// TARGET (a bug-bounty program's app), NEVER the bughunter-web login.
//
// COMPLIANCE CAVEAT: these are credentials for the target program's own app. The
// operator is responsible for ensuring the test accounts and their use comply
// with that program's rules of engagement.
//
// SECURITY: a cookie map / bearer token is accepted on POST, immediately
// encrypted via `encryptSecret`, and stored only in cookiesCipher/headerCipher.
// It is NEVER echoed back. GET exposes only booleans (hasCookies/hasToken),
// never the cipher or plaintext — same rule as hasApiKey on AI providers.

export const runtime = "nodejs"; // node:crypto in encryptSecret requires the Node runtime

const createSchema = z.object({
  label: z.string().trim().min(1).max(200),
  // Either a cookie map or a raw "k=v; k2=v2" cookie string.
  cookies: z
    .union([z.record(z.string(), z.string()), z.string()])
    .optional(),
  bearerToken: z.string().optional(),
});

/** Parse a raw "k=v; k2=v2" cookie string into a map. Skips malformed segments. */
function parseCookieString(raw: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const seg = part.trim();
    if (!seg) continue;
    const eq = seg.indexOf("=");
    if (eq <= 0) continue;
    const name = seg.slice(0, eq).trim();
    const value = seg.slice(eq + 1).trim();
    if (name) map[name] = value;
  }
  return map;
}

/** Load a target owned by the session user, or null. */
async function loadOwnedTarget(targetId: string, userId: string) {
  return prisma.target.findFirst({
    where: { id: targetId, userId },
    select: { id: true },
  });
}

/**
 * GET /api/targets/[id]/credentials — list this target's saved credentials.
 * Exposes ONLY id/label/createdAt plus hasCookies/hasToken booleans. NEVER the
 * decrypted content or ciphertext.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const target = await loadOwnedTarget(id, session.user.id);
  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rows = await prisma.targetCredential.findMany({
    where: { targetId: id },
    orderBy: { createdAt: "desc" },
  });

  const credentials = rows.map((r) => ({
    id: r.id,
    label: r.label,
    createdAt: r.createdAt,
    hasCookies: Boolean(r.cookiesCipher),
    hasToken: Boolean(r.headerCipher),
  }));

  return NextResponse.json({ credentials });
}

/**
 * POST /api/targets/[id]/credentials — add a credential for this target.
 * Requires at least one of cookies/bearerToken (400 otherwise). A raw cookie
 * string is parsed to a map before JSON+encrypt. Returns the safe shape only.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const target = await loadOwnedTarget(id, session.user.id);
  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { label, cookies, bearerToken } = parsed.data;

  // Normalize cookies into a map (parse a raw string), then encrypt its JSON.
  let cookieMap: Record<string, string> | undefined;
  if (typeof cookies === "string") {
    const m = parseCookieString(cookies);
    if (Object.keys(m).length > 0) cookieMap = m;
  } else if (cookies && Object.keys(cookies).length > 0) {
    cookieMap = cookies;
  }

  const token =
    typeof bearerToken === "string" && bearerToken.trim().length > 0
      ? bearerToken.trim()
      : undefined;

  // Enforce the "at least one of cookies/headerCipher" invariant at the API
  // layer (the DB allows both to be null).
  if (!cookieMap && !token) {
    return NextResponse.json(
      { error: "Provide at least one of: cookies, bearerToken" },
      { status: 400 },
    );
  }

  const cookiesCipher = cookieMap
    ? encryptSecret(JSON.stringify(cookieMap))
    : null;
  const headerCipher = token ? encryptSecret(token) : null;

  const created = await prisma.targetCredential.create({
    data: { targetId: id, label, cookiesCipher, headerCipher },
  });

  // Safe shape only — never the cipher or plaintext.
  return NextResponse.json(
    {
      credential: {
        id: created.id,
        label: created.label,
        createdAt: created.createdAt,
        hasCookies: Boolean(created.cookiesCipher),
        hasToken: Boolean(created.headerCipher),
      },
    },
    { status: 201 },
  );
}

/**
 * DELETE /api/targets/[id]/credentials?credentialId=... — remove one credential
 * owned via the target.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const target = await loadOwnedTarget(id, session.user.id);
  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const credentialId = new URL(req.url).searchParams.get("credentialId");
  if (!credentialId) {
    return NextResponse.json(
      { error: "Missing credentialId" },
      { status: 400 },
    );
  }

  // Scope the delete to this target so a credential can't be removed cross-target.
  const result = await prisma.targetCredential.deleteMany({
    where: { id: credentialId, targetId: id },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
