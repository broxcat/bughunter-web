import { open, constants } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { verifyReconDelivery, reconDeliveryPrompt } from '../../../src/lib/research/reconDelivery.ts';
import { targetWorkspaceId } from '../../../src/lib/research/terminal.ts';
import { providerTmuxIdentity } from '../../../src/lib/research/provider.ts';
import { openConsoleWorkspace, childPath } from '../validator/console-files.mjs';
import { readBounded } from '../validator/burp-files.mjs';

/** No CLI inference or configuration changes. Stages a fixed message without pressing Enter. */
export async function stageReconContext(token, publicKey, execute, spent = new Map()) {
  const claims = verifyReconDelivery(token, publicKey);
  for (const [id, expires] of spent) if (expires < Date.now()) spent.delete(id);
  if (spent.has(claims.deliveryId) || spent.size >= 10000) throw new Error('RECON_DELIVERY_REPLAY');
  spent.set(claims.deliveryId, claims.exp * 1000);
  const workspace = await openConsoleWorkspace(`/workspaces/${targetWorkspaceId(claims.targetId)}`);
  let recon;
  try {
    if (workspace.policy.sessionId !== claims.sessionId || workspace.policySha256 !== claims.policySha256) throw new Error('POLICY_CHANGED');
    recon = await open(childPath(workspace.root, 'recon'), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    for (const [name, expected, limit] of [
      [`snapshot-${claims.contentSha256}.json`, claims.contentSha256, 1024 * 1024],
      [`summary-${claims.contentSha256}.json`, claims.summarySha256, 24 * 1024],
    ]) {
      const raw = await readBounded(recon, name, limit, true);
      if (createHash('sha256').update(raw).digest('hex') !== expected) throw new Error('RECON_INTEGRITY_MISMATCH');
    }
    const target = `=${providerTmuxIdentity(claims.targetId, claims.provider)}`;
    await execute('tmux', ['has-session', '-t', target], { timeout: 3000 });
    const buffer = `recon-${claims.deliveryId}`;
    try {
      await execute('tmux', ['set-buffer', '-b', buffer, '--', reconDeliveryPrompt(claims.contentSha256)], { timeout: 3000 });
      // Bracketed paste prevents embedded characters being interpreted as keystrokes.
      // Only the operator submits the message once the CLI is ready.
      // paste-buffer expects target-pane, whose session component needs the colon.
      try { await execute('tmux', ['paste-buffer', '-p', '-b', buffer, '-t', `${target}:`], { timeout: 3000 }); }
      catch (error) { error.deliveryUncertain = true; throw error; }
    } finally { await execute('tmux', ['delete-buffer', '-b', buffer], { timeout: 3000 }).catch(() => {}); }
    return { status: 'STAGED', provider: claims.provider, contentSha256: claims.contentSha256 };
  } finally { await recon?.close(); await workspace.root.close(); }
}
