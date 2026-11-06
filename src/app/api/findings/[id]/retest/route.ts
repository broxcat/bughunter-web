import {recordFindingRetest} from '@/server/findingLifecycle';
import {coverageRequest,coverageBody,coverageJson,coverageError} from '@/server/research/coverageRequest';
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){try{const result=await recordFindingRetest(await coverageRequest(req,true),(await params).id,await coverageBody(req));return coverageJson({id:result.id,outcome:result.outcome},201);}catch(e){return coverageError(e);}}
