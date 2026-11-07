import {Prisma} from '@prisma/client';
import { normalizeCookies, sessionState } from "@/lib/targetAuth";
import { credentialMetadataSchema,credentialMetadataPatchSchema, ownedReferenceUrl } from "@/lib/credentialMetadata";
import { foreignOrigin } from '@/lib/requestOrigin';
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { assetAllowsUrl, type AssetBoundary } from '@/lib/scopeAssets';

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
  ...credentialMetadataSchema.shape,
  label: z.string().trim().min(1).max(200),
  mode: z.enum(["COOKIES", "BEARER", "EMAIL_PASSWORD"]).optional(),
  // Either a cookie map or a raw "k=v; k2=v2" cookie string.
  cookies: z
    .union([z.record(z.string(), z.string()), z.string()])
    .optional(),
  bearerToken: z.string().max(8192).refine(value=>!/[\r\n\x00]/.test(value),'Invalid bearer token').optional(),
  // EMAIL_PASSWORD mode: the app logs in via headless Chromium to mint cookies.
  loginUrl: z.string().trim().url().optional(),
  email: z.string().trim().min(1).optional(),
  username: z.string().trim().min(1).optional(),
  password: z.string().min(1).optional(),
});

/** Client-safe view of a credential row — never ciphers or plaintext secrets. */
function toSafe(r: {
  id: string;
  label: string;
  mode: "COOKIES" | "BEARER" | "EMAIL_PASSWORD";
  purpose: string;
  ownedObjectUrl: string | null;
  cookiesCipher: string | null;
  headerCipher: string | null;
  emailCipher: string | null;
  loginUrl: string | null;
  sessionRefreshedAt: Date | null;
  sessionStatus?: string;
  sessionCheckedAt?: Date | null;
  sessionExpiresAt?: Date | null;
  persona?:string|null;
  reconEnabled?:boolean;
  createdAt: Date;
}) {
  return {
    id: r.id,
    label: r.label,
    mode: r.mode,
    purpose: r.purpose,
    persona:r.persona??null,
    reconEnabled:r.reconEnabled??false,
    ownedObjectUrl: r.ownedObjectUrl,
    createdAt: r.createdAt,
    hasCookies: Boolean(r.cookiesCipher),
    hasToken: Boolean(r.headerCipher),
    // EMAIL_PASSWORD: configured (creds stored) + when the session was last minted.
    hasAutoLogin: r.mode === "EMAIL_PASSWORD" && Boolean(r.emailCipher),
    sessionStatus: sessionState(r),
    sessionCheckedAt: r.sessionCheckedAt ?? null,
    sessionVerifiedAt:r.sessionStatus==='VALID'?r.sessionCheckedAt??null:null,
    sessionExpiresAt: r.sessionExpiresAt ?? null,
    sessionRefreshedAt: r.sessionRefreshedAt,
  };
}

/** Load a target owned by the session user, or null. */
async function loadOwnedTarget(targetId: string, userId: string) {
  return prisma.target.findFirst({
    where: { id: targetId, userId },
    select: { id: true, host: true, scopeAsset: { select: { normalizedValue: true, format: true, active: true } }, discoveredFromAsset: { select: { normalizedValue: true, format: true, active: true } } },
  });
}

/** Preserve an exact URL asset's port/path; a discovered host never widens its parent boundary. */
function ownedObjectReference(target: { host: string; scopeAsset?: AssetBoundary | null; discoveredFromAsset?: AssetBoundary | null }, value: string | null | undefined) {
  const exactUrl=target.scopeAsset?.format==='URL'?target.scopeAsset:target.discoveredFromAsset?.format==='URL'?target.discoveredFromAsset:null;
  const host=exactUrl?new URL(exactUrl.normalizedValue).host:target.host;
  const result=ownedReferenceUrl(value,host);
  if(result && [target.scopeAsset,target.discoveredFromAsset].some(boundary=>boundary&&!assetAllowsUrl(boundary,result)))throw new Error('Owned object is outside the selected Scope Asset boundary');
  return result;
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
    orderBy: [{createdAt:'desc'},{id:'desc'}],
  });

  const credentials = rows.map(toSafe);

  return NextResponse.json({ credentials },{headers:{'Cache-Control':'private, no-store'}});
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
  if(foreignOrigin(req))return NextResponse.json({error:'Forbidden'},{status:403});
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

  const { label, cookies, bearerToken, loginUrl, password } = parsed.data;
  const email = parsed.data.username ?? parsed.data.email;
  let ownedObjectUrl: string | null;
  try { ownedObjectUrl = ownedObjectReference(target,parsed.data.ownedObjectUrl); }
  catch { return NextResponse.json({ error: "Owned object must be an authorized same-host URL without secrets" }, { status: 400 }); }
  const metadata = { purpose: parsed.data.purpose, ownedObjectUrl,persona:parsed.data.persona??null,reconEnabled:parsed.data.reconEnabled };

  // EMAIL_PASSWORD: store encrypted email/password + loginUrl; cookies are minted
  // later by headless auto-login. Requires all three.
  const wantsEmailPassword =
    parsed.data.mode === "EMAIL_PASSWORD" || Boolean(email || password);
  if (wantsEmailPassword) {
    if (!email || !password) {
      return NextResponse.json(
        { error: "Username and password are required" },
        { status: 400 },
      );
    }
    const created = await prisma.targetCredential.create({
      data: {
        targetId: id,
        ...metadata,
        label,
        mode: "EMAIL_PASSWORD",
        loginUrl,
        emailCipher: encryptSecret(email),
        passwordCipher: encryptSecret(password),
      },
     }).catch(error=>{if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2003')return null;throw error;});
    if(!created)return NextResponse.json({error:'Not found'},{status:404});
    return NextResponse.json(
      { credential: toSafe(created) },
      { status: 201 },
    );
  }

  let cookieMap: Record<string, string> | undefined;
  if (cookies !== undefined) {
    try { cookieMap = normalizeCookies(cookies); }
    catch { return NextResponse.json({ error: "Invalid session cookie" }, { status: 400 }); }
  }

  const token =
    typeof bearerToken === "string" && bearerToken.trim().length > 0
      ? bearerToken.trim()
      : undefined;

  // Enforce the "at least one of cookies/headerCipher" invariant at the API
  // layer (the DB allows both to be null).
  if (!cookieMap && !token) {
    return NextResponse.json(
      { error: "Provide at least one of: cookies, bearerToken, or email+password (EMAIL_PASSWORD)" },
      { status: 400 },
    );
  }

  const created = await prisma.targetCredential.create({
    data: {
      targetId: id,
      ...metadata,
      label,
      mode: token && !cookieMap ? "BEARER" : "COOKIES",
      cookiesCipher: cookieMap ? encryptSecret(JSON.stringify(cookieMap)) : null,
      headerCipher: token ? encryptSecret(token) : null,
    },
   }).catch(error=>{if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2003')return null;throw error;});
  if(!created)return NextResponse.json({error:'Not found'},{status:404});

  // Safe shape only — never the cipher or plaintext.
  return NextResponse.json({ credential: toSafe(created) }, { status: 201 });
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
  if(foreignOrigin(req))return NextResponse.json({error:'Forbidden'},{status:403});
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

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if(foreignOrigin(req))return NextResponse.json({error:'Forbidden'},{status:403});
  const { id } = await params;
  const target = await loadOwnedTarget(id, session.user.id);
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = credentialMetadataPatchSchema.extend({ credentialId: z.string().min(1) }).refine(value=>Object.keys(value).some(key=>key!=='credentialId'),'Provide credential metadata to change').safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid credential metadata" }, { status: 400 });
  const credential = await prisma.targetCredential.findFirst({ where: { id: parsed.data.credentialId, targetId: id } });
  if (!credential) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const data = {...(parsed.data.purpose!==undefined?{purpose:parsed.data.purpose}:{}),...(parsed.data.ownedObjectUrl!==undefined?{ownedObjectUrl:ownedObjectReference(target,parsed.data.ownedObjectUrl)}:{}),...(parsed.data.persona!==undefined?{persona:parsed.data.persona}:{}),...(parsed.data.reconEnabled!==undefined?{reconEnabled:parsed.data.reconEnabled}:{})};
    return NextResponse.json({ credential: toSafe(await prisma.targetCredential.update({ where: { id: credential.id,targetId:id }, data })) });
  } catch(error) {
    if(error instanceof Prisma.PrismaClientKnownRequestError){
      if(error.code==='P2025')return NextResponse.json({error:'Not found'},{status:404});
      return NextResponse.json({error:'Credential metadata update unavailable'},{status:503});
    }
    return NextResponse.json({ error: "Owned object must be an authorized same-host URL without secrets" }, { status: 400 });
  }
}
