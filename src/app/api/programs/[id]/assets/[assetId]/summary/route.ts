import { summaryRoute } from '@/server/recon/summaryRoute';
type Context={params:Promise<{id:string;assetId?:string}>};
export const GET=(req:Request,{params}:Context)=>summaryRoute(req,params);
export const POST=GET;
