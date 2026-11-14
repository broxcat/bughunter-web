import { withApiBoundary } from '@/lib/apiBoundary';
import { assertPublicScopeValues, scopeAdmissionResponse } from '@/server/scopeAdmission';
import {prisma} from '@/lib/prisma';
import {paginationInput} from '@/lib/pagination';
import {assetReconStatus} from '@/lib/scopeAssets';
import {listTargetAssets} from '@/server/recon/intelligence';
import {lockOwnedProgram,backfillProgramAssets} from '@/server/scopeAssets';
import { auth } from '@/lib/auth';
import { foreignOrigin } from '@/lib/requestOrigin';
import { assetInputSchema } from '@/lib/scopeAssets';
import { listScopeAssets, createScopeAsset, assetError } from '@/server/scopeAssets';

type Context = { params: Promise<{ id: string }> };
 async function handleGET(_req: Request, { params }: Context) {
  const session = await auth(); if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const query=new URL(_req.url).searchParams;
  if(query.has('page')||query.has('pageSize')){
    let input;try{input=paginationInput(query);}catch{return Response.json({error:'Invalid page or pageSize'},{status:400});}
    try{
      const userId=session.user.id,programId=(await params).id;
      await prisma.$transaction(async tx=>{await lockOwnedProgram(tx,userId,programId);await backfillProgramAssets(tx,programId,userId);});
      const result=await listTargetAssets(userId,programId,input,query.get('active')==='1');
      // Preserve the legacy metadata upgrade, only for records on this page.
      const {ensureLegacyArtifacts}=await import('@/server/recon/artifacts');
      for(const asset of result.items){const run=asset.scanRuns[0];if(run&&run.artifactVersion<2&&!['QUEUED','RUNNING'].includes(run.status)){await ensureLegacyArtifacts(run.id);run._count.artifacts=await prisma.reconArtifact.count({where:{scanRunId:run.id}});}}
      return Response.json({...result,items:result.items.map(asset=>({...asset,reconStatus:assetReconStatus(asset.scanRuns[0]??null)}))},{headers:{'Cache-Control':'no-store'}});
    }catch(e){return assetError(e);}
  }
  try { return Response.json(await listScopeAssets(session.user.id, (await params).id), { headers: { 'Cache-Control': 'no-store' } }); } catch (e) { return assetError(e); }
}
 async function handlePOST(req: Request, { params }: Context) {
  const session = await auth(); if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  if (Number(req.headers.get('content-length')) > 4096) return Response.json({ error: 'Input too large' }, { status: 413 });
  const input = assetInputSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) return Response.json({ error: input.error.issues.map(i => i.message).join('; ') }, { status: 400 });
  try { await assertPublicScopeValues([input.data.value]); } catch (e) { const refused = scopeAdmissionResponse(e); if (refused) return refused; throw e; }
  try { return Response.json(await createScopeAsset(session.user.id, (await params).id, input.data), { status: 201 }); } catch (e) { return assetError(e); }
}

export const GET = withApiBoundary(handleGET, ["id"]);
export const POST = withApiBoundary(handlePOST, ["id"]);
