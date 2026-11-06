import {attachEvidence} from '@/server/evidenceVault';
import {coverageRequest,coverageBody,coverageJson,coverageError} from '@/server/research/coverageRequest';
export async function POST(req:Request,{params}:{params:Promise<{targetId:string;evidenceId:string}>}){try{const user=await coverageRequest(req,true),p=await params;return coverageJson(await attachEvidence(user,p.targetId,p.evidenceId,await coverageBody(req)));}catch(e){return coverageError(e);}}
