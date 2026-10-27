// Operator-only bootstrap. Password comes from stdin, never argv or logs.
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";

const [emailArg, nameArg] = process.argv.slice(2);
const email = z.string().trim().max(254).email().safeParse(emailArg);
const name = z.string().trim().min(1).max(100).safeParse(nameArg);
if (!email.success || !name.success || process.stdin.isTTY) {
  console.error('Usage: npm run user:create -- email name < /secure/password-file');
  process.exit(1);
}
const password = readFileSync(0, "utf8").replace(/\r?\n$/, "");
if (password.length < 10 || Buffer.byteLength(password, "utf8") > 72) {
  console.error("Password must contain at least 10 characters and at most 72 UTF-8 bytes.");
  process.exit(1);
}
const prisma = new PrismaClient();
try {
  await prisma.user.create({ data: { email: email.data.toLowerCase(), name: name.data, passwordHash: await bcrypt.hash(password, 12) }, select: { id: true } });
  console.log("Account created. Public registration policy is unchanged.");
} catch {
  console.error("Account creation failed. Check database availability and whether the account already exists.");
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
