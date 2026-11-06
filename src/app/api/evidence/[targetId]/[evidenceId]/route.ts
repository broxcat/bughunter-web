import {getEvidence} from '@/server/evidenceVault';
import {coverageRequest,coverageJson,coverageError} from '@/server/research/coverageRequest';
export async function GET(req:Request,{params}:{params:Promise<{targetId:string;evidenceId:string}>}){try{const user=await coverageRequest(req),p=await params;return coverageJson(await getEvidence(user,p.targetId,p.evidenceId));}catch(e){return coverageError(e);}}
