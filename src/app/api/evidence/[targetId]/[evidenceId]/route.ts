import { withApiBoundary } from '@/lib/apiBoundary';
import {getEvidence} from '@/server/evidenceVault';
import {coverageRequest,coverageJson,coverageError} from '@/server/research/coverageRequest';
 async function handleGET(req:Request,{params}:{params:Promise<{targetId:string;evidenceId:string}>}){try{const user=await coverageRequest(req),p=await params;return coverageJson(await getEvidence(user,p.targetId,p.evidenceId));}catch(e){return coverageError(e);}}

export const GET = withApiBoundary(handleGET, ["targetId","evidenceId"]);
