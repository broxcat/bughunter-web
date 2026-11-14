import { withApiBoundary } from '@/lib/apiBoundary';
import {findingLifecycle,changeFindingLifecycle} from '@/server/findingLifecycle';
import {coverageRequest,coverageBody,coverageJson,coverageError} from '@/server/research/coverageRequest';
type Context={params:Promise<{id:string}>};
 async function handleGET(req:Request,{params}:Context){try{return coverageJson(await findingLifecycle(await coverageRequest(req),(await params).id));}catch(e){return coverageError(e);}}
 async function handlePOST(req:Request,{params}:Context){try{return coverageJson(await changeFindingLifecycle(await coverageRequest(req,true),(await params).id,await coverageBody(req)),201);}catch(e){return coverageError(e);}}

export const GET = withApiBoundary(handleGET, ["id"]);
export const POST = withApiBoundary(handlePOST, ["id"]);
