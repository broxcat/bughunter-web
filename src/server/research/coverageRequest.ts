import {auth} from '@/lib/auth';
import {foreignOrigin} from '@/lib/requestOrigin';
import {ResearchError} from './workspace';
import {HypothesisSyncError} from './hypothesisFiles';
export const coverageJson=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
export async function coverageRequest(req:Request,write=false){
 const user=(await auth())?.user?.id;if(!user)throw new ResearchError('Unauthorized',401);
 if(write&&foreignOrigin(req))throw new ResearchError('Forbidden',403);return user;
}
export async function coverageBody(req:Request){
 const reader=req.body?.getReader();if(!reader)throw new ResearchError('A structured coverage body is required',400);
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768){await reader.cancel();throw new ResearchError('Coverage record is too large',413);}chunks.push(value);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ResearchError('Invalid JSON coverage record',400);}
 }finally{reader.releaseLock();}
}
export function coverageError(error:unknown){return coverageJson({error:error instanceof ResearchError||error instanceof HypothesisSyncError?error.message:'Coverage operation unavailable'},error instanceof ResearchError||error instanceof HypothesisSyncError?error.status:503);}
