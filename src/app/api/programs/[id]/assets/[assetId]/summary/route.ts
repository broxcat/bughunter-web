import { withApiBoundary } from '@/lib/apiBoundary';
import { summaryRoute } from '@/server/recon/summaryRoute';
type Context={params:Promise<{id:string;assetId?:string}>};
 const handleGET=(req:Request,{params}:Context)=>summaryRoute(req,params);
 const handlePOST=handleGET;

export const GET = withApiBoundary(handleGET, ["id","assetId"]);
export const POST = withApiBoundary(handlePOST, ["id","assetId"]);
