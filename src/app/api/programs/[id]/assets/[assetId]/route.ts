import { auth } from '@/lib/auth';
import { foreignOrigin } from '@/lib/requestOrigin';
import { assetEditSchema,assetReplaceSchema,assetRetireSchema } from '@/lib/scopeAssets';
import { editScopeAsset,replaceScopeAsset } from '@/server/scopeAssets';
import { assetError } from '@/server/scopeAssets';
type Context = { params: Promise<{ id: string; assetId: string }> };
async function mutate(req: Request, { params }: Context, remove: boolean) {
  const session = await auth(); if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (foreignOrigin(req)) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const body=await req.json().catch(()=>null);
  const retirement=remove?assetRetireSchema.safeParse(body??{}):null;
  if(retirement&&!retirement.success)return Response.json({error:'Invalid retirement request'},{status:400});
  const input = remove ? null : assetEditSchema.safeParse(body);
  if (input && !input.success) return Response.json({ error: 'Invalid type or asset value' }, { status: 400 });
  const { id, assetId } = await params;
  try { return Response.json(await editScopeAsset(session.user.id, id, assetId, input?.success ? input.data : null,retirement?.success?retirement.data.expectedUpdatedAt:undefined)); } catch (e) { return assetError(e); }
}
export const PATCH = (req: Request, context: Context) => mutate(req, context, false);
export const DELETE = (req: Request, context: Context) => mutate(req, context, true);

export async function POST(req:Request,{params}:Context){
  const session=await auth();if(!session?.user?.id)return Response.json({error:'Unauthorized'},{status:401});
  if(foreignOrigin(req))return Response.json({error:'Forbidden'},{status:403});
  if(Number(req.headers.get('content-length'))>4096)return Response.json({error:'Input too large'},{status:413});
  const input=assetReplaceSchema.safeParse(await req.json().catch(()=>null));
  if(!input.success)return Response.json({error:input.error.issues.map(i=>i.message).join('; ')},{status:400});
  const{id,assetId}=await params;
  try{return Response.json(await replaceScopeAsset(session.user.id,id,assetId,input.data),{status:201});}catch(e){return assetError(e);}
}
