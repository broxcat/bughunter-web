import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { normalizeLogin, publicRegistrationEnabled } from "@/lib/abusePolicy";

const RegisterSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().max(254).email("A valid email is required"),
  password: z.string().min(10, "Password must be at least 10 characters")
    .refine(value => Buffer.byteLength(value, "utf8") <= 72, "Password must be at most 72 bytes"),
});
const accepted = () => NextResponse.json({ message: "If this address can be registered, your account is ready. Please sign in." }, { status: 200 });

export async function POST(req: Request) {
  if (!publicRegistrationEnabled()) {
    return NextResponse.json({ error: "Public registration is disabled. Contact your administrator." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
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
