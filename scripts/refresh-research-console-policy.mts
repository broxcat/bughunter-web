// Operator-only command inside web after stopping the target's tmux session.
// No arbitrary path, command, target requests or MCP configuration is accepted.
import { constants } from 'node:fs';
import { open, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { prisma } from '../src/lib/prisma';
import { targetIdentity } from '../src/lib/research/terminal';
import { consoleRoot, consoleBundle } from '../src/server/research/consoleWorkspace';
import { assertResearchTarget, researchAuthorizationSnapshot, researchTargetSelect } from '../src/server/research/workspace';
const targetId = targetIdentity.parse(process.argv[2]);
if (process.env.RESEARCH_CONFIRM_TMUX_STOPPED !== 'yes') throw new Error('Stop this Target tmux session first, then explicitly set RESEARCH_CONFIRM_TMUX_STOPPED=yes. No policy was changed.');
try {
 await prisma.$transaction(async tx => {
  await tx.$queryRaw`SELECT "id" FROM "Target" WHERE "id"=${targetId} FOR UPDATE`;
  const target=await tx.target.findUniqueOrThrow({where:{id:targetId},select:researchTargetSelect});assertResearchTarget(target,target.userId);
  await tx.$queryRaw`SELECT "id" FROM "Scope" WHERE "id"=${target.scope.id} FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "BountyProgram" WHERE "id"=${target.program!.id} FOR SHARE`;
  const current=await tx.target.findUniqueOrThrow({where:{id:targetId},select:researchTargetSelect});assertResearchTarget(current,current.userId);
  const session=await tx.researchSession.findUniqueOrThrow({where:{consoleTargetId:targetId}});
  if(session.userId!==current.userId || session.workspaceId!==`research_${targetId}`) throw new Error('Console ownership mismatch');
  const files=consoleBundle(current,null,[],{...session,createdAt:new Date()}),root=join(consoleRoot(),session.workspaceId);
  const directory=await open(root,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try {
   // Only fixed protected inputs change. Notes/captures/Recon/old ZIPs stay intact.
   for(const name of ['scope.md','.codex/config.toml','.agents/bughunter/AGENTS.md','.agents/bughunter/target.json','.agents/bughunter/policy.json','.agents/bughunter/bootstrap.md']){
    let parent=await open(`/proc/self/fd/${directory.fd}`,constants.O_RDONLY|constants.O_DIRECTORY);
    try {const parts=name.split('/');for(const part of parts.slice(0,-1)){const next=await open(`/proc/self/fd/${parent.fd}/${part}`,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);await parent.close();parent=next;}
     const base=parts.at(-1)!,temp=`/proc/self/fd/${parent.fd}/.refresh-${base}`;
     const f=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o440);
     try{await f.chown(process.getuid!(),Number(process.env.RESEARCH_WORKSPACE_GID??process.getgid?.()));await f.writeFile(files[name]);await f.sync();}finally{await f.close();}
     await rename(temp,`/proc/self/fd/${parent.fd}/${base}`);
    }finally{await parent.close();}
   }
  } finally{await directory.close();}
  await tx.researchSession.update({where:{id:session.id},data:{authorizationSnapshot:researchAuthorizationSnapshot(current),scopeMarkdown:files['scope.md']}});
 },{timeout:15000});
 console.log('Current approved policy refreshed. Research notes and original Recon retained; reconnect to restart Codex/MCP.');
}finally{await prisma.$disconnect();}
