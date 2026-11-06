import {coverageHistory} from '@/server/research/coverage';
import {coverageRequest,coverageJson,coverageError} from '@/server/research/coverageRequest';
export async function GET(req:Request,{params}:{params:Promise<{targetId:string}>}){try{const user=await coverageRequest(req),url=new URL(req.url),before=Number(url.searchParams.get('before'))||undefined;return coverageJson(await coverageHistory(user,(await params).targetId,url.searchParams.get('coverageId')??'',before));}catch(e){return coverageError(e);}}
