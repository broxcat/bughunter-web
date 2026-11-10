import {retireScopeAssetInTransaction,settleScopeAssetRetirement} from './scopeAssets';
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { normalizeFqdn } from "@/lib/bountyProgram";
export class HostError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
/** Serialize host mutations per program; a partial DB index also prevents races. */
export async function mutateHost(ownerId: string, programId: string, action: "ADD" | "EDIT" | "REMOVE", input: { host?: string; hostId?: string; legacyTargetId?: string }) {
  let retiredAssetId:string|undefined;
  const result=await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "BountyProgram" WHERE id = ${programId} AND "ownerId" = ${ownerId} AND "deletingAt" IS NULL FOR UPDATE`;
    if (!rows.length) throw new HostError("Target not found", 404);
    const updateWildcardRule = async (next?: string) => {
      if (!previous?.host.startsWith('*.') && !next?.startsWith('*.')) return;
      const program = await tx.bountyProgram.findUniqueOrThrow({ where: { id: programId } });
      const rules = program.scopeRules.filter(rule => rule !== previous?.host);
      if (next?.startsWith('*.')) rules.push(next);
      await tx.bountyProgram.update({ where: { id: programId }, data: { scopeRules: [...new Set(rules)] } });
    };
    const previous = input.hostId ? await tx.target.findFirst({ where: { id: input.hostId, programId, userId: ownerId, active: true, contextOnly: false } }) : null;
    if (action !== "ADD" && !previous) throw new HostError("Host not found", 404);
    const retirePreviousAsset=async()=>{
      if(!previous?.scopeAssetId)return;
      const asset=await tx.scopeAsset.findFirst({where:{id:previous.scopeAssetId,programId}});
      if(!asset)throw new HostError('Scope asset unavailable',409);
      await retireScopeAssetInTransaction(tx,programId,asset);retiredAssetId=asset.id;
    };
    if (action === "REMOVE") { await retirePreviousAsset();await updateWildcardRule(); return tx.target.update({ where: { id: previous!.id }, data: { active: false } }); }
    const host = normalizeFqdn(input.host ?? "");
    if (previous?.host === host) return previous;
    if (await tx.target.findFirst({ where: { programId, active: true, host } })) throw new HostError("This host is already in Scope", 409);
    await updateWildcardRule(host);
    if (input.legacyTargetId) {
      const old = await tx.target.findFirst({ where: { id: input.legacyTargetId, userId: ownerId, programId: null }, include: { scope: true } });
      if (!old || normalizeFqdn(old.host) !== host) throw new HostError("Previous host not found or FQDN differs", 404);
      if (old.scope.status !== "APPROVED") throw new HostError("This previous host cannot be reused. Add its FQDN as a new scope host.");
      // Different Programs hold different locks. Admission must still compare
      // the legacy identity's unassigned state atomically; a stale adopter
      // must never move a Target already claimed by the other transaction.
      return tx.target.update({ where: { id: old.id,userId:ownerId,programId:null }, data: { programId, active: true } }).catch(error=>{
        if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2025')throw new HostError('This previous host was assigned to another Target; reload Scope',409);
        throw error;
      });
    }
    if(previous)await retirePreviousAsset();
    if (previous) await tx.target.update({ where: { id: previous.id }, data: { active: false } });
    const scope = await tx.scope.create({ data: { userId: ownerId, hostPattern: host, status: "APPROVED" } });
    return tx.target.create({ data: { userId: ownerId, programId, scopeId: scope.id, host, active: true } });
  });
  if(retiredAssetId)try{await settleScopeAssetRetirement();}catch{throw new HostError('Host retired; scan cancellation unconfirmed. Retry from the Scope asset history.',503);}
  return result;
}
export function hostErrorResponse(error: unknown) {
  if (error instanceof HostError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return Response.json({ error: "This host is already in Scope" }, { status: 409 });
  if (error instanceof Error && error.message.startsWith("Enter a FQDN")) return Response.json({ error: error.message }, { status: 400 });
  throw error;
}
