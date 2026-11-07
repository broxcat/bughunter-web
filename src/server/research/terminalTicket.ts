import { prisma } from '@/lib/prisma';
import { providerSelection, researchProvider, type LaunchProfile, type ResearchProvider } from '@/lib/research/provider';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { issueTerminalTicket, sha256 } from '@/lib/research/terminal';
import { ensureTargetConsole, consoleRoot } from './consoleWorkspace';
import { ResearchError } from './workspace';
import { join } from 'node:path';
import { readTerminalSigningKey } from './terminalKey';

export function terminalTicket(userId: string, targetId: string, requestedProvider?: ResearchProvider, profile?: LaunchProfile) {
  return issueCheckedTicket(userId,targetId,requestedProvider,profile,true);
}
// Server/operator-only issuance; no HTTP route exposes this pre-migration path.
export function isolationMigrationTicket(userId:string,targetId:string) {
  return issueCheckedTicket(userId,targetId,undefined,undefined,false);
}
async function issueCheckedTicket(userId: string, targetId: string, requestedProvider: ResearchProvider|undefined, profile: LaunchProfile|undefined, requireIsolation:boolean) {
  if (requestedProvider !== undefined) researchProvider.parse(requestedProvider);
  const { session, target } = await ensureTargetConsole(userId, targetId);
  // Only server-generated paths, and immutable critical files. No shell or runner calls.
  const directory = await open(join(consoleRoot(), session.workspaceId), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const file = await open(`/proc/self/fd/${directory.fd}/.agents`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    let metadata;
    try { metadata = await open(`/proc/self/fd/${file.fd}/bughunter`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); } finally { await file.close(); }
    let policy;
    try { policy = await open(`/proc/self/fd/${metadata.fd}/policy.json`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); } finally { await metadata.close(); }
    let text;
    try { const stat = await policy.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024 || stat.mode & 0o222) throw new ResearchError('Unsafe console policy', 409); text = await policy.readFile(); } finally { await policy.close(); }
    const privateKey = await readTerminalSigningKey();
    const provider = requestedProvider ?? session.provider ?? 'codex';
    providerSelection.parse({provider,profile});
    if (requestedProvider !== undefined && provider !== session.provider) {
      await prisma.researchSession.update({ where: { id: session.id, userId }, data: { provider } });
    }
    const issued = issueTerminalTicket({ userId, targetId, sessionId: session.id, policySha256: sha256(text), ...(provider === 'claude' ? { provider } : {}), ...(profile ? {profile} : {}) }, privateKey);
    if(requireIsolation){
    const readiness=await fetch(new URL('/control/isolation',process.env.RESEARCH_TERMINAL_CONTROL_URL??'http://research-console:7681'),{method:'POST',headers:{Authorization:'Bearer '+issued.token},signal:AbortSignal.timeout(10000),redirect:'error'}).catch(()=>null);
    if(!readiness?.ok)throw new ResearchError('Research workspace requires isolation migration before it can be opened.',409);
    }
    return { ...issued, provider, profile: profile ?? (provider === 'codex' ? 'yolo' : 'standard'), host: target.host, requiredUserAgent: target.program!.requiredUserAgent };
  } finally { await directory.close(); }
}
