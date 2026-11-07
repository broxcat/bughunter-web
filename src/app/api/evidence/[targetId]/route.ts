import {createEvidence,listEvidence} from '@/server/evidenceVault';
import {coverageRequest,coverageBody,coverageJson,coverageError} from '@/server/research/coverageRequest';
type Context={params:Promise<{targetId:string}>};
export async function GET(req:Request,{params}:Context){try{const user=await coverageRequest(req),q=new URL(req.url).searchParams;return coverageJson(await listEvidence(user,(await params).targetId,{hypothesisId:q.get('hypothesisId')??undefined,findingId:q.get('findingId')??undefined,coverageEventId:q.get('coverageEventId')??undefined,reportId:q.get('reportId')??undefined},q.get('before')??undefined));}catch(e){return coverageError(e);}}
export async function POST(req:Request,{params}:Context){try{return coverageJson(await createEvidence(await coverageRequest(req,true),(await params).targetId,await coverageBody(req)),201);}catch(e){return coverageError(e);}}
