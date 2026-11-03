import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect,notFound } from 'next/navigation';
import ScopeAssetDetails from '@/components/ScopeAssetDetails';
export default async function ScopePage({params}:{params:Promise<{id:string}>}){const{id}=await params,s=await auth();if(!s?.user?.id)return null;const asset=await prisma.scopeAsset.findFirst({where:{id,program:{ownerId:s.user.id}},select:{id:true,programId:true}});if(asset)return <ScopeAssetDetails programId={asset.programId} assetId={asset.id}/>;const program=await prisma.bountyProgram.findFirst({where:{id,ownerId:s.user.id},select:{id:true}});if(program)redirect('/scopes?target='+program.id);const host=await prisma.target.findFirst({where:{scopeId:id,userId:s.user.id},select:{id:true,scopeAssetId:true}});if(host)redirect(host.scopeAssetId?'/scopes/'+host.scopeAssetId:'/hosts/'+host.id);notFound();}
