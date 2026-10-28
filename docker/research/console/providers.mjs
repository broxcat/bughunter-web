import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { claudeConfigDirectory } from '../validator/claude-config.mjs';
import { providerTmuxIdentity } from '../../../src/lib/research/provider.ts';
const execute = promisify(execFile);
export const providers = Object.freeze({
  codex: Object.freeze({ command: 'codex', launcher: '/usr/local/bin/bughunter-codex', authArgs: ['login', 'status'] }),
  claude: Object.freeze({ command: 'claude', launcher: '/usr/local/bin/bughunter-claude', authArgs: ['auth', 'status'] }),
});
export function providerAdapter(provider = 'codex') {
  if (!Object.hasOwn(providers, provider)) throw new Error('INVALID_PROVIDER');
  return providers[provider];
}
export function sessionCommand(targetId, provider = 'codex') {
  return { name: providerTmuxIdentity(targetId, provider), launcher: providerAdapter(provider).launcher };
}
/** Only safe enums/version metadata leave the runner. Raw auth output may contain account details.
 * @param {'codex'|'claude'} provider
 * @param {(file: string, args: string[], options: object) => Promise<{stdout: string}>} run
 * @param {string | undefined} cwd
 */
export async function providerStatus(provider = 'codex', run = execute, cwd = undefined) {
  const adapter = providerAdapter(provider);
  const status = { provider, installation: 'available', authentication: 'unknown', version: null, code: null };
  const options = { timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 16384, shell: false, cwd: '/tmp', ...(provider === 'claude' && cwd ? { env: { ...process.env, CLAUDE_CONFIG_DIR: claudeConfigDirectory(cwd), DISABLE_AUTOUPDATER: '1' } } : {}) };
  try {
    const { stdout } = await run(adapter.command, ['--version'], options);
    status.version = /\b\d+\.\d+\.\d+\b/.exec(stdout)?.[0] ?? null;
  } catch (e) { return { ...status, installation: e.code === 'ENOENT' ? 'missing' : 'error', code: e.code === 'ENOENT' ? 'CLI_MISSING' : 'CLI_CHECK_FAILED' }; }
  try {
    const { stdout } = await run(adapter.command, adapter.authArgs, options);
    if (provider === 'codex') status.authentication = 'authenticated';
    else { const data = JSON.parse(stdout); if (data.loggedIn === true) status.authentication = 'authenticated'; else if (data.loggedIn === false) status.authentication = 'required'; }
  } catch (e) {
    if (provider === 'codex' && e.code === 1) status.authentication = 'required';
    if (provider === 'claude' && e.code === 1) {
      try { if (JSON.parse(e.stdout).loggedIn === false) status.authentication = 'required'; } catch { /* Unknown CLI format. */ }
    }
  }
  if (status.authentication !== 'authenticated') status.code = status.authentication === 'required' ? 'AUTH_REQUIRED' : 'AUTH_CHECK_FAILED';
  return status;
}
