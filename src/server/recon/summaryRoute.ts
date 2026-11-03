import { auth } from '@/lib/auth';
import { foreignOrigin } from '@/lib/requestOrigin';
import { summaryView,scheduleReconSummary } from './summaries';
import { assetError } from '../scopeAssets';
import { z } from 'zod';
export async function summaryRoute(req:Request,params:Promise<{id:string;assetId?:string}>){
  const session=await auth();if(!session?.user?.id)return Response.json({error:'Unauthorized'},{status:401});
  if(req.method==='POST'&&foreignOrigin(req))return Response.json({error:'Forbidden'},{status:403});
  const{id,assetId}=await params;
  try{
    if(req.method==='POST'){const body=z.strictObject({regenerate:z.boolean().default(false)}).safeParse(await req.json().catch(()=>({})));if(!body.success)return Response.json({error:'Invalid request'},{status:400});
      const latest=await summaryView(session.user.id,id,assetId);
      if(latest.summary&&['PENDING','RUNNING'].includes(latest.summary.status))return Response.json(latest,{status:202});
      await scheduleReconSummary(session.user.id,id,assetId,body.data.regenerate);
    }
    return Response.json(await summaryView(session.user.id,id,assetId),{status:req.method==='POST'?202:200});
  }catch(e){return assetError(e);}
}
