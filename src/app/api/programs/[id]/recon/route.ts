import { withApiBoundary } from '@/lib/apiBoundary';
import { reconRunStatus } from '@/server/recon/runHistory';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { advanceCampaign, changeCampaign } from '@/server/campaignOrchestrator';
import { foreignOrigin } from '@/lib/requestOrigin';
import { assetError } from '@/server/scopeAssets';
import { startTargetRecon,targetReconState,cancelTargetRecon } from '@/server/recon/targetRuns';
type Params={params:Promise<{id:string}>};
 async function handleGET(_req:Request,{params}:Params){const s=await auth();if(!s?.user?.id)return Response.json({error:'Unauthorized'},{status:401});try{const id=(await params).id,runId=new URL(_req.url).searchParams.get('runId');return Response.json(runId!==null?await reconRunStatus(s.user.id,id,runId):await targetReconState(s.user.id,id),{headers:{'Cache-Control':'no-store'}});}catch(e){return assetError(e);}}
 async function handlePOST(req: Request, { params }: Params) {
  const ownerId = (await auth())?.user?.id;
  if (!ownerId) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  try {
    if (await prisma.targetCampaign.findFirst({ where: { programId: id, program: { ownerId } }, select: { programId: true } })) {
      await changeCampaign(ownerId, id, 'start');
      await advanceCampaign(ownerId, id).catch(() => {});
      return Response.json({ accepted: true }, { status: 202 });
    }
    return Response.json(await startTargetRecon(ownerId, id), { status: 202 });
  } catch (error) { return assetError(error); }
}
 async function handleDELETE(req:Request,{params}:Params){const s=await auth();if(!s?.user?.id)return Response.json({error:'Unauthorized'},{status:401});if(foreignOrigin(req))return Response.json({error:'Forbidden'},{status:403});try{const id=(await params).id,state=await targetReconState(s.user.id,id);if(!state.latest)return Response.json({error:'No Recon run'},{status:404});return Response.json(await cancelTargetRecon(s.user.id,id,state.latest.id));}catch(e){return assetError(e);}}

export const GET = withApiBoundary(handleGET, ["id"]);
export const POST = withApiBoundary(handlePOST, ["id"]);
export const DELETE = withApiBoundary(handleDELETE, ["id"]);
