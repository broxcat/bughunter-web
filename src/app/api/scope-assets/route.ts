import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { listTargetAssets } from '@/server/recon/intelligence';
import { backfillProgramAssets,lockOwnedProgram,assetError } from '@/server/scopeAssets';
export async function GET(req:Request){const s=await auth();if(!s?.user?.id)return Response.json({error:'Unauthorized'},{status:401});try{const target=new URL(req.url).searchParams.get('target')??undefined;const programs=await prisma.bountyProgram.findMany({where:{ownerId:s.user.id,...(target?{id:target}:{})},select:{id:true},take:1000});for(const p of programs)await prisma.$transaction(async tx=>{await lockOwnedProgram(tx,s.user.id!,p.id);await backfillProgramAssets(tx,p.id,s.user.id!);});return Response.json(await listTargetAssets(s.user.id,target),{headers:{'Cache-Control':'no-store'}});}catch(e){return assetError(e);}}
