import {syncResearchCoverage} from '@/server/research/coverage';
import {coverageRequest,coverageBody,coverageJson,coverageError} from '@/server/research/coverageRequest';
import {z} from 'zod';
import {ResearchError} from '@/server/research/workspace';
export async function POST(req:Request,{params}:{params:Promise<{targetId:string}>}){try{const user=await coverageRequest(req,true),body=z.strictObject({sessionId:z.string().min(1).max(150)}).safeParse(await coverageBody(req));if(!body.success)throw new ResearchError('Select a session',400);return coverageJson(await syncResearchCoverage(user,(await params).targetId,body.data.sessionId));}catch(e){return coverageError(e);}}
