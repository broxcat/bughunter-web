import {researchCoverageState,recordResearchCoverage} from '@/server/research/coverage';
import {coverageRequest,coverageBody,coverageJson,coverageError} from '@/server/research/coverageRequest';
type Context={params:Promise<{targetId:string}>};
export async function GET(req:Request,{params}:Context){try{return coverageJson(await researchCoverageState(await coverageRequest(req),(await params).targetId));}catch(e){return coverageError(e);}}
export async function POST(req:Request,{params}:Context){try{const user=await coverageRequest(req,true),body=await coverageBody(req);const event=await recordResearchCoverage(user,(await params).targetId,body);return coverageJson({id:event.id,revision:event.revision},201);}catch(e){return coverageError(e);}}
