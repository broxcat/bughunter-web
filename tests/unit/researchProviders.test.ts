import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { vi } from 'vitest';
import { runInteractiveCli } from '../../docker/research/validator/interactive-process.mjs';
import { generateKeyPairSync } from 'node:crypto';
import { providerSelection, providerTmuxIdentity } from '@/lib/research/provider';
import { issueTerminalTicket, verifyTerminalTicket } from '@/lib/research/terminal';
// Runner modules also run in the final image without the Next.js application.
import { providerAdapter, providerStatus, sessionCommand } from '../../docker/research/console/providers.mjs';
import { claudeArguments } from '../../docker/research/validator/claude-config.mjs';

describe('Research providers', () => {
  it('keeps the historical Codex identity and a disjoint Claude namespace', () => {
    expect(sessionCommand('target')).toEqual({ name: 'bughunter-target', launcher: '/usr/local/bin/bughunter-codex' });
    expect(sessionCommand('target', 'claude')).toEqual({ name: 'bughunter_claude_target', launcher: '/usr/local/bin/bughunter-claude' });
    expect(providerTmuxIdentity('claude_target')).not.toBe(providerTmuxIdentity('target', 'claude'));
    for (const provider of ['bash', '__proto__', 'claude;id']) {
      expect(() => providerAdapter(provider)).toThrow(); expect(providerSelection.safeParse({ provider }).success).toBe(false);
    }
    expect(() => sessionCommand('../other', 'claude')).toThrow();
    expect(providerSelection.safeParse({ provider: 'claude', command: 'bash' }).success).toBe(false);
  });
  it('signs provider claims without changing the shape of historical tickets', () => {
    const keys = generateKeyPairSync('ed25519'), privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const ids = { userId: 'user', targetId: 'target', sessionId: 'session', policySha256: 'a'.repeat(64) };
    expect(verifyTerminalTicket(issueTerminalTicket(ids, privateKey).token, publicKey).provider).toBeUndefined();
    expect(verifyTerminalTicket(issueTerminalTicket({ ...ids, provider: 'claude' }, privateKey).token, publicKey).provider).toBe('claude');
    const [payload, signature] = issueTerminalTicket({ ...ids, provider: 'claude' }, privateKey).token.split('.');
    const changed = { ...JSON.parse(Buffer.from(payload, 'base64url').toString()), provider: 'codex' };
    expect(() => verifyTerminalTicket(`${Buffer.from(JSON.stringify(changed)).toString('base64url')}.${signature}`, publicKey)).toThrow('INVALID_TICKET');
  });
  it.each(['codex', 'claude'] as const)('checks %s installation and auth independently without disclosing output', async provider => {
    const calls: unknown[] = [];
    const run = async (file: string, args: string[], options: object) => { calls.push([file, args, options]); return { stdout: args[0] === '--version' ? (provider === 'codex' ? 'codex-cli 0.165.0' : '2.1.312 (Claude Code)') : JSON.stringify({ loggedIn: true, email: 'PRIVATE', apiKey: 'SECRET' }) }; };
    const status = await providerStatus(provider, run);
    expect(status.authentication).toBe('authenticated'); expect(status.installation).toBe('available');
    expect(JSON.stringify(status)).not.toMatch(/PRIVATE|SECRET/); expect(calls).toHaveLength(2);
  });
  it('handles missing, failed and unauthenticated CLIs without guessing from exit code alone', async () => {
    expect(await providerStatus('claude', async () => { throw Object.assign(new Error(), { code: 'ENOENT' }); })).toMatchObject({ installation: 'missing', authentication: 'unknown', code: 'CLI_MISSING' });
    for (const stdout of ['garbled', '{}', '{"loggedIn":false}']) {
      const run = async (_file: string, args: string[]) => { if (args[0] === '--version') return { stdout: '2.1.312' }; throw Object.assign(new Error(), { code: 1, stdout }); };
      expect(await providerStatus('claude', run)).toMatchObject({ authentication: stdout === '{"loggedIn":false}' ? 'required' : 'unknown' });
    }
    expect(await providerStatus('claude', async (_file: string, args: string[]) => ({ stdout: args[0] === '--version' ? '2.1.312' : '{"loggedIn":true}' }))).toMatchObject({ authentication: 'authenticated' });
  });
  it('builds isolated Claude arguments with native continuation and passive MCP only', () => {
    const args = claudeArguments('/workspaces/research_target', 'Trusted instructions', true);
    expect(args).toContain('--continue'); expect(args).toContain('--strict-mcp-config');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('manual');
    const mcp = JSON.parse(args[args.indexOf('--mcp-config') + 1]);
    expect(mcp.mcpServers).toEqual({ bughunter_burp: { type: 'stdio', command: '/usr/local/bin/bughunter-burp-passive-mcp', args: [] } });
    expect(args).not.toContain('--dangerously-skip-permissions'); expect(args).not.toContain('--yolo');
    expect(claudeArguments('/workspaces/research_target', 'Rules', false)).not.toContain('--continue');
    expect(() => claudeArguments('/tmp/user;command', 'Rules')).toThrow();
  });
});

describe('native CLI lifecycle', () => {
  it.each([{code:0,signal:null,expected:0},{code:23,signal:null,expected:23},{code:null,signal:'SIGTERM',expected:143}])('propagates process exit $expected and cleans signal handlers', async ({code, signal, expected}) => {
    const child = Object.assign(new EventEmitter(), {kill:vi.fn()}), initial = process.listenerCount('SIGTERM');
    const spawn = vi.fn(() => child);
    const result = runInteractiveCli('claude', ['--continue'], {cwd:'/tmp'}, spawn);
    expect(process.listenerCount('SIGTERM')).toBe(initial+1);
    process.emit('SIGTERM'); expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('exit',code,signal); expect(await result).toBe(expected);
    expect(process.listenerCount('SIGTERM')).toBe(initial);
    expect(spawn.mock.calls[0]).toEqual(['claude',['--continue'],{cwd:'/tmp',stdio:'inherit',shell:false}]);
  });
  it('reports spawn errors and removes signal handlers', async () => {
    const child = Object.assign(new EventEmitter(), {kill:vi.fn()}), initial=process.listenerCount('SIGINT');
    const log=vi.spyOn(console,'error').mockImplementation(()=>{});
    const result=runInteractiveCli('claude',[],{},()=>child);
    child.emit('error',new Error('SECRET credential error'));
    expect(await result).toBe(1);expect(process.listenerCount('SIGINT')).toBe(initial);
    expect(log).toHaveBeenCalledWith('Research CLI could not start. Check installation and authentication.');log.mockRestore();
  });
});
