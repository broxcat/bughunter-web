import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { issueTerminalTicket, sha256 } from '@/lib/research/terminal';
import { ensureTargetConsole, consoleRoot } from './consoleWorkspace';
import { ResearchError } from './workspace';
import { join } from 'node:path';

export async function terminalTicket(userId: string, targetId: string) {
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
    try { const stat = await policy.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8192 || stat.mode & 0o222) throw new ResearchError('Unsafe console policy', 409); text = await policy.readFile(); } finally { await policy.close(); }
    const key = await open(process.env.RESEARCH_TERMINAL_PRIVATE_KEY_FILE ?? '/run/research-terminal/private.pem', constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let privateKey;
    try { const s = await key.stat(); if (!s.isFile() || s.size > 2048 || s.mode & 0o077) throw new Error('UNSAFE_SIGNING_KEY'); privateKey = await key.readFile('utf8'); } finally { await key.close(); }
    return { ...issueTerminalTicket({ userId, targetId, sessionId: session.id, policySha256: sha256(text) }, privateKey), host: target.host, requiredUserAgent: target.program!.requiredUserAgent };
  } finally { await directory.close(); }
}
