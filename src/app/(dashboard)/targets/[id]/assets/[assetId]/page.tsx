import ScopeAssetDetails from '@/components/ScopeAssetDetails';
import {auth} from '@/lib/auth';
import {prisma} from '@/lib/prisma';
import {notFound} from 'next/navigation';
export default async function Page({params}:{params:Promise<{id:string;assetId:string}>}){const {id,assetId}=await params;const userId=(await auth())?.user?.id;if(!userId)return null;if(!await prisma.scopeAsset.findFirst({where:{id:assetId,programId:id,program:{ownerId:userId}}}))notFound();return <ScopeAssetDetails programId={id} assetId={assetId}/>;}
