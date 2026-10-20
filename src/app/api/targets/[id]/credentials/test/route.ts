import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { acquireSessionCookies } from "@/server/credentials/autoLogin";

// POST /api/targets/[id]/credentials/test — ad-hoc "test the login" for the
// EMAIL_PASSWORD form, so the operator can verify credentials BEFORE saving /
// before a full hunt. It runs the real headless auto-login and reports only
// success/failure + a cookie COUNT — never the cookies, email, or password. It
// does NOT persist anything.

export const runtime = "nodejs"; // Playwright/Chromium needs the Node runtime

const testSchema = z.object({
  loginUrl: z.string().trim().url(),
  email: z.string().trim().min(1),
  password: z.string().min(1),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  // Ownership: the target must belong to the signed-in user.
  const target = await prisma.target.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = testSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await acquireSessionCookies(parsed.data);
  const cookieCount = Object.keys(result.cookies).length;
  const ok = cookieCount > 0 && !result.error;

  // Never return the cookies themselves — only whether login worked and how many
  // cookies came back. `result.error` is a diagnostic string with no secrets.
  return NextResponse.json({ ok, cookieCount, error: result.error ?? null });
}
