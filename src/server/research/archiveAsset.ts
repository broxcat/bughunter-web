import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { prisma } from '@/lib/prisma';
import { issueStopTicket } from '@/lib/research/terminal';
import { consoleRoot } from './consoleWorkspace';
import { researchRootFor } from './sessions';
import { readTerminalSigningKey } from './terminalKey';
import { ResearchError } from './workspace';
/** Archive revokes attachment and quiesces native work while retaining all
 * transcripts, snapshots, Findings and workspace files. It never deletes threads. */
export async function pauseAssetResearch(userId:string,assetId:string) {
  const sessions=await prisma.researchSession.findMany({where:{userId,target:{userId,OR:[{scopeAssetId:assetId},{discoveredFromAssetId:assetId}]}},select:{workspaceId:true,targetId:true}});
  if(!sessions.length)return;
  for(const session of sessions){
    const root=session.workspaceId.startsWith('research_')?consoleRoot():researchRootFor(session.workspaceId);
    try{const directory=await open(join(root,session.workspaceId),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{const marker=await open(`/proc/self/fd/${directory.fd}/.deleting`,constants.O_CREAT|constants.O_RDONLY|constants.O_NOFOLLOW,0o440);try{const stat=await marker.stat();if(!stat.isFile()||stat.nlink!==1||stat.uid!==process.getuid!())throw new ResearchError('Unsafe authorization marker',409);await marker.chmod(0o440);}finally{await marker.close();}}finally{await directory.close();}}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  }
  const key=await readTerminalSigningKey();
  for(const session of sessions){const response=await fetch(new URL('/control/pause',process.env.RESEARCH_TERMINAL_CONTROL_URL??'http://research-console:7681'),{method:'POST',headers:{Authorization:'Bearer '+issueStopTicket(session.targetId,session.workspaceId,key)},signal:AbortSignal.timeout(30000),redirect:'error'});if(!response.ok||(await response.json()).stopped!==true)throw new ResearchError('Authorization revoked; Research process cleanup unconfirmed. Retry archive after restoring the console service.',503);}
}
