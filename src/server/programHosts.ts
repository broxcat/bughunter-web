import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { normalizeFqdn } from "@/lib/bountyProgram";
export class HostError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
/** Serialize host mutations per program; a partial DB index also prevents races. */
export async function mutateHost(ownerId: string, programId: string, action: "ADD" | "EDIT" | "REMOVE", input: { host?: string; hostId?: string; legacyTargetId?: string }) {
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "BountyProgram" WHERE id = ${programId} AND "ownerId" = ${ownerId} FOR UPDATE`;
    if (!rows.length) throw new HostError("Target not found", 404);
    const previous = input.hostId ? await tx.target.findFirst({ where: { id: input.hostId, programId, userId: ownerId, active: true } }) : null;
    if (action !== "ADD" && !previous) throw new HostError("Host not found", 404);
    if (action === "REMOVE") return tx.target.update({ where: { id: previous!.id }, data: { active: false } });
    const host = normalizeFqdn(input.host ?? "");
    if (previous?.host === host) return previous;
    if (await tx.target.findFirst({ where: { programId, active: true, host } })) throw new HostError("This host is already in Scope", 409);
    if (input.legacyTargetId) {
      const old = await tx.target.findFirst({ where: { id: input.legacyTargetId, userId: ownerId, programId: null }, include: { scope: true } });
      if (!old || normalizeFqdn(old.host) !== host) throw new HostError("Previous host not found or FQDN differs", 404);
      if (old.scope.status !== "APPROVED") throw new HostError("This previous host cannot be reused. Add its FQDN as a new scope host.");
      return tx.target.update({ where: { id: old.id }, data: { programId, active: true } });
    }
    if (previous) await tx.target.update({ where: { id: previous.id }, data: { active: false } });
    const scope = await tx.scope.create({ data: { userId: ownerId, hostPattern: host, status: "APPROVED" } });
    return tx.target.create({ data: { userId: ownerId, programId, scopeId: scope.id, host, active: true } });
  });
}
export function hostErrorResponse(error: unknown) {
  if (error instanceof HostError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return Response.json({ error: "This host is already in Scope" }, { status: 409 });
  if (error instanceof Error && error.message.startsWith("Enter a FQDN")) return Response.json({ error: error.message }, { status: 400 });
  throw error;
}
