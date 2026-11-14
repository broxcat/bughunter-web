import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { RATE_LIMIT_POLICIES, normalizeLogin, publicRegistrationEnabled } from "@/lib/abusePolicy";
import { isUsableClientIdentity, resolveClientIp } from "@/lib/clientIdentity";
import { rateLimit } from "@/lib/rateLimit";
import { foreignOrigin } from "@/lib/requestOrigin";

const RegisterSchema = z.strictObject({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().max(254).email("A valid email is required"),
  password: z.string().min(10, "Password must be at least 10 characters")
    .refine(value => Buffer.byteLength(value, "utf8") <= 72, "Password must be at most 72 bytes"),
});
const MAX_BODY_BYTES = 4096;
const accepted = () => NextResponse.json({ message: "If this address can be registered, your account is ready. Please sign in." }, { status: 200 });

/** B3: per-client and global windows run before any bcrypt work; a limiter
 * outage refuses registration rather than allowing unbounded hashing. */
async function registrationAdmission(req: Request): Promise<Response | null> {
  const ip = resolveClientIp(req);
  const { registerIp, registerGlobal } = RATE_LIMIT_POLICIES;
  const results = isUsableClientIdentity(ip)
    ? await Promise.all([rateLimit(`rl:register:ip:${ip.ip}`, registerIp.limit, registerIp.windowSec), rateLimit("rl:register:global", registerGlobal.limit, registerGlobal.windowSec)])
    : [{ status: "UNAVAILABLE" as const }];
  if (results.some(result => result.status === "UNAVAILABLE")) {
    return NextResponse.json({ error: "Registration temporarily unavailable. Please try again shortly." }, { status: 503, headers: { "Retry-After": "30" } });
  }
  const blocked = results.filter(result => result.status === "BLOCKED") as { resetSec: number }[];
  if (blocked.length) {
    logger.warn({ operation: "register", code: "rate_limited", identitySource: ip.source }, "registration refused by anti-abuse policy");
    return NextResponse.json({ error: "Too many registration attempts. Please try again later." }, { status: 429, headers: { "Retry-After": String(Math.max(...blocked.map(result => result.resetSec))) } });
  }
  return null;
}

export async function POST(req: Request) {
  if (!publicRegistrationEnabled()) {
    return NextResponse.json({ error: "Public registration is disabled. Contact your administrator." }, { status: 403 });
  }
  if (foreignOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES) return NextResponse.json({ error: "Input too large" }, { status: 413 });
  const refused = await registrationAdmission(req);
  if (refused) return refused;
  const text = await req.text().catch(() => "");
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return NextResponse.json({ error: "Input too large" }, { status: 413 });
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { /* reported as validation failure */ }
  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const email = normalizeLogin(parsed.data.email);
  try {
    // Perform the same expensive hash before checking existence. Never change
    // an existing account, return its fields, or disclose its existence.
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!existing) await prisma.user.create({ data: { name: parsed.data.name, email, passwordHash }, select: { id: true } });
    return accepted();
  } catch (err) {
    // Concurrent signups for the same address have the same public response.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return accepted();
    logger.error({ code: "REGISTRATION_DATABASE_ERROR" }, "register: failed to create user");
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
