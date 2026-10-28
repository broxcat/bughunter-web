import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reconcileClaudeMcp } from '../../docker/research/validator/managed-mcp.mjs';
import { claudeArguments, claudeConfigDirectory } from '../../docker/research/validator/claude-config.mjs';
import { consoleMcpOverrides } from '../../docker/research/validator/console-mcp-config.mjs';

describe('persistent managed MCP', () => {
  it('reconciles repeatedly, preserves user config/auth/transcripts and isolates deletion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mcp-persistence-'));
    try {
      const a = join(root, 'a'), b = join(root, 'b');
      const file = await reconcileClaudeMcp(a); await reconcileClaudeMcp(b);
      for (const name of ['settings.json', '.credentials.json', 'session.jsonl']) await writeFile(join(a, name), 'USER DATA');
      const content = await readFile(file, 'utf8');
      for (let i = 0; i < 3; i++) expect(await reconcileClaudeMcp(a)).toBe(file);
      expect(await readFile(file, 'utf8')).toBe(content);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      for (const name of ['settings.json', '.credentials.json', 'session.jsonl']) expect(await readFile(join(a, name), 'utf8')).toBe('USER DATA');
      await rm(file); await reconcileClaudeMcp(a);
      expect(await readFile(file, 'utf8')).toBe(content);
      await rm(a, { recursive: true });
      expect(await readFile(join(b, 'bughunter-mcp.json'), 'utf8')).toBe(content);
      const args = claudeArguments('/workspaces/research_a', '', true, file);
      expect(args[args.indexOf('--mcp-config') + 1]).toBe(file);
      expect(args).toContain('--continue');
      expect(claudeConfigDirectory('/workspaces/research_a')).not.toBe(claudeConfigDirectory('/workspaces/research_b'));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('refuses configuration symlinks without changing their target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mcp-links-'));
    try {
      const directory = join(root, 'context');
      await reconcileClaudeMcp(directory);
      const target = join(root, 'user-settings'); await writeFile(target, 'USER DATA');
      await rm(join(directory, 'bughunter-mcp.json'));
      await symlink(target, join(directory, 'bughunter-mcp.json'));
      await expect(reconcileClaudeMcp(directory)).rejects.toThrow('UNSAFE_CONFIG_FILE');
      expect(await readFile(target, 'utf8')).toBe('USER DATA');
    } finally { await rm(root, {recursive:true, force:true}); }
  });
  it('keeps Burp independent of Research container identity', async () => {
    const compose = await readFile('docker-compose.yml', 'utf8');
    const burp = compose.split('  burp:\n')[1].split('  research-terminal-proxy:')[0];
    expect(burp).not.toContain('network_mode:');
    expect(burp).not.toContain('depends_on:');
    expect(burp).toContain('aliases: [burp-private]');
    expect(compose).toContain('burp_link:\n    internal: true');
  });
  it('recreates Codex managed runtime entries without rewriting user configuration', () => {
    const cwd = '/workspaces/research_a';
    expect(consoleMcpOverrides(cwd)).toEqual(consoleMcpOverrides(cwd));
    expect(consoleMcpOverrides(cwd).join(' ')).toContain('bughunter-portswigger-mcp');
    expect(consoleMcpOverrides(cwd).join(' ')).toContain(cwd);
    expect(consoleMcpOverrides('/tmp/untrusted')).toEqual([]);
  });
});
