import { reconRunStatus } from '@/server/recon/runHistory';
import { auth } from '@/lib/auth';
import { foreignOrigin } from '@/lib/requestOrigin';
import { assetError } from '@/server/scopeAssets';
import { startTargetRecon,targetReconState,cancelTargetRecon } from '@/server/recon/targetRuns';
type Params={params:Promise<{id:string}>};
export async function GET(_req:Request,{params}:Params){const s=await auth();if(!s?.user?.id)return Response.json({error:'Unauthorized'},{status:401});try{const id=(await params).id,runId=new URL(_req.url).searchParams.get('runId');return Response.json(runId!==null?await reconRunStatus(s.user.id,id,runId):await targetReconState(s.user.id,id),{headers:{'Cache-Control':'no-store'}});}catch(e){return assetError(e);}}
export async function POST(req:Request,{params}:Params){const s=await auth();if(!s?.user?.id)return Response.json({error:'Unauthorized'},{status:401});if(foreignOrigin(req))return Response.json({error:'Forbidden'},{status:403});try{return Response.json(await startTargetRecon(s.user.id,(await params).id),{status:202});}catch(e){return assetError(e);}}
export async function DELETE(req:Request,{params}:Params){const s=await auth();if(!s?.user?.id)return Response.json({error:'Unauthorized'},{status:401});if(foreignOrigin(req))return Response.json({error:'Forbidden'},{status:403});try{const id=(await params).id,state=await targetReconState(s.user.id,id);if(!state.latest)return Response.json({error:'No Recon run'},{status:404});return Response.json(await cancelTargetRecon(s.user.id,id,state.latest.id));}catch(e){return assetError(e);}}
