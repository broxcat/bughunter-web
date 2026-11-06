import {publishResearchCoverage} from '@/server/research/coverage';
import {coverageRequest,coverageJson,coverageError} from '@/server/research/coverageRequest';
export async function POST(req:Request,{params}:{params:Promise<{targetId:string}>}){try{return coverageJson(await publishResearchCoverage(await coverageRequest(req,true),(await params).targetId));}catch(e){return coverageError(e);}}
