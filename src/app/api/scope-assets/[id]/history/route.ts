import { withApiBoundary } from '@/lib/apiBoundary';
import {reconHistory} from '@/server/recon/history';
import {coverageRequest,coverageJson,coverageError} from '@/server/research/coverageRequest';
 async function handleGET(req:Request,{params}:{params:Promise<{id:string}>}){try{const user=await coverageRequest(req),url=new URL(req.url);return coverageJson(await reconHistory(user,(await params).id,url.searchParams.get('current')??undefined,url.searchParams.get('previous')??undefined));}catch(e){return coverageError(e);}}

export const GET = withApiBoundary(handleGET, ["id"]);
