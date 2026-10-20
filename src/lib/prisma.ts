import { PrismaClient } from "@prisma/client";

// Shared Prisma client singleton. Reused across the app and the worker process.
// In dev we stash it on globalThis so Next.js hot-reload doesn't open a new pool
// on every change. Import this everywhere instead of `new PrismaClient()`.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
