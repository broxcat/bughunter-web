import { auth } from '@/lib/auth';
import { foreignOrigin } from '@/lib/requestOrigin';
import { assetError } from '@/server/scopeAssets';
import { loadAssetReconDetail } from '@/server/recon/intelligence';
type Context={params:Promise<{id:string;assetId:string}>};
export async function GET(req:Request,{params}:Context){const s=await auth();if(!s?.user?.id)return Response.json({error:'Unauthorized'},{status:401});const{id,assetId}=await params;try{return Response.json(await loadAssetReconDetail(s.user.id,id,assetId,new URL(req.url).searchParams.get('run')??undefined),{headers:{'Cache-Control':'no-store'}});}catch(e){return assetError(e);}}
export async function POST(req:Request,{params}:Context){const s=await auth();if(!s?.user?.id)return Response.json({error:'Unauthorized'},{status:401});if(foreignOrigin(req))return Response.json({error:'Forbidden'},{status:403});const{id}=await params;return Response.json({error:'Start Target-wide Recon from the Target page.',href:'/targets/'+id},{status:410});}
