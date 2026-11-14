// Operator-only (M3): invalidate every outstanding session of one account, e.g.
// after a password reset, a lost device or offboarding. JWTs carry the
// sessionVersion they were issued under; bumping it rejects them on next use.
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const email = z.string().trim().max(254).email().safeParse(process.argv[2]);
if (!email.success) {
  console.error("Usage: npm run user:revoke-sessions -- email");
  process.exit(1);
}
const prisma = new PrismaClient();
try {
  const { count } = await prisma.user.updateMany({ where: { email: email.data.toLowerCase() }, data: { sessionVersion: { increment: 1 } } });
  console.log(count ? "All sessions of this account are revoked." : "No such account.");
  if (!count) process.exitCode = 1;
} catch {
  console.error("Revocation failed. Check database availability.");
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
