import { spawn } from 'node:child_process';
import { runInteractiveCli } from './interactive-process.mjs';
import { readdir, mkdir, lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { openConsoleWorkspace } from './console-files.mjs';
import { claudeArguments, claudeInstructions, claudeConfigDirectory } from './claude-config.mjs';

export async function launchClaude({ cwd = process.cwd(), env = process.env, spawnProcess = spawn } = {}) {
  const workspace = await openConsoleWorkspace(cwd);
  await workspace.root.close();
  // Claude documents --continue as scoped to the current working directory.
  // Check only for the presence of native transcripts; never parse their contents.
  const config = claudeConfigDirectory(cwd);
  await mkdir(config, { recursive: true, mode: 0o700 });
  if (await realpath(config) !== config || !(await lstat(config)).isDirectory() || (await lstat(config)).isSymbolicLink()) throw new Error('UNSAFE_FILE');
  const directory = join(config, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
  const resume = await readdir(directory).then(files => files.some(f => /^[a-f0-9-]{36}\.jsonl$/.test(f)), e => { if (e.code === 'ENOENT') return false; throw e; });
  console.log(`Claude Code · passive Research\nTarget: ${workspace.policy.targetHost}\nRequired User-Agent: ${workspace.policy.requiredUserAgent}\n${resume ? 'Continuing Claude history for this workspace.' : 'Starting a separate Claude conversation.'}\nUse /login to authenticate and /model to select an available model. Ctrl+C interrupts; /exit stops Claude.`);
  return runInteractiveCli('claude', claudeArguments(cwd, claudeInstructions, resume), { cwd, env: { ...env, CLAUDE_CONFIG_DIR: config, DISABLE_AUTOUPDATER: '1' } }, spawnProcess);
}
if (process.argv[1]?.endsWith('/validator/claude-launch.mjs')) {
  try { process.exitCode = await launchClaude(); }
  catch { console.error('Claude console configuration unavailable.'); process.exitCode = 1; }
}
