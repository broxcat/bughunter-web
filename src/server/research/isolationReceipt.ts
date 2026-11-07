import {constants} from 'node:fs';
import {open,type FileHandle} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {ResearchError} from './workspace';
const receiptSchema=z.strictObject({v:z.literal(1),uid:z.number().int().min(200001).max(299999),gid:z.number().int(),targetId:z.string(),workspaceId:z.string(),sessionId:z.string(),policySha256:z.string().regex(/^[a-f0-9]{64}$/),state:z.literal('active')});
export async function isolatedPublication(directory:FileHandle,expected:{targetId:string;workspaceId:string;sessionId:string}) {
 let agents,metadata,file;
 try {
  agents=await open(`/proc/self/fd/${directory.fd}/.agents`,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  metadata=await open(`/proc/self/fd/${agents.fd}/bughunter`,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{file=await open(`/proc/self/fd/${metadata.fd}/isolation.json`,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
  const st=await file.stat();
  if(!st.isFile()||st.uid!==0||st.nlink!==1||(st.mode&0o7777)!==0o440||st.size>4096)throw new Error();
  const receipt=receiptSchema.parse(JSON.parse(await file.readFile('utf8')));
  if(receipt.uid!==receipt.gid||st.gid!==receipt.gid||Object.entries(expected).some(([key,value])=>receipt[key as keyof typeof expected]!==value))throw new Error();
  const root=await directory.stat();if(root.uid!==0||root.gid!==receipt.gid||(root.mode&0o7777)!==0o750)throw new Error();
  const policy=await open(`/proc/self/fd/${metadata.fd}/policy.json`,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const st=await policy.stat();if(!st.isFile()||st.uid!==0||st.nlink!==1||st.mode&0o222||st.size>1024*1024||createHash('sha256').update(await policy.readFile()).digest('hex')!==receipt.policySha256)throw new Error();}finally{await policy.close();}
  return receipt;
 }catch{throw new ResearchError('Workspace isolation receipt is invalid',409);}
 finally{await file?.close();await metadata?.close();await agents?.close();}
}
