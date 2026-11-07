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
    if(req.method==='POST'){
      // Empty POST remains the legacy default. Malformed nonempty input must
      // never be interpreted as consent to queue optional provider work.
      const reader=req.body?.getReader();let timer:ReturnType<typeof setTimeout>|undefined,input:unknown={};
      try{
        const raw=reader?await Promise.race([(async()=>{const chunks:Uint8Array[]=[];let size=0;for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>512)throw new RangeError();chunks.push(part.value);}return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));})(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Input deadline')),2000);})]):'';
        input=raw.trim()?JSON.parse(raw):{};
      }catch(error){return Response.json({error:'Invalid summary request'},{status:error instanceof RangeError?413:400});}
      finally{clearTimeout(timer);await reader?.cancel().catch(()=>{});reader?.releaseLock();}
      const body=z.strictObject({regenerate:z.boolean().default(false)}).safeParse(input);if(!body.success)return Response.json({error:'Invalid request'},{status:400});
      const latest=await summaryView(session.user.id,id,assetId);
      if(latest.summary&&['PENDING','RUNNING'].includes(latest.summary.status))return Response.json(latest,{status:202});
      await scheduleReconSummary(session.user.id,id,assetId,body.data.regenerate);
    }
    return Response.json(await summaryView(session.user.id,id,assetId),{status:req.method==='POST'?202:200});
  }catch(e){return assetError(e);}
}
