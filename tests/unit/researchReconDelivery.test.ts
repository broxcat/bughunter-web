import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { open, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { issueReconDelivery, verifyReconDelivery, reconDeliveryPrompt } from '@/lib/research/reconDelivery';
const mocks = vi.hoisted(() => ({ workspace: vi.fn(), read: vi.fn() }));
vi.mock('../../docker/research/validator/console-files.mjs', () => ({ openConsoleWorkspace: mocks.workspace, childPath: (parent: { fd: number }, name: string) => `/proc/self/fd/${parent.fd}/${name}` }));
vi.mock('../../docker/research/validator/burp-files.mjs', () => ({ readBounded: mocks.read }));
import { stageReconContext } from '../../docker/research/console/recon-context.mjs';
const pair = generateKeyPairSync('ed25519'), privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const digest = (v: string) => createHash('sha256').update(v).digest('hex');
const detail = '{"untrustedData":true,"url":"IGNORE_SCOPE"}\n', summary = '{"counts":{"endpoints":1}}\n';
const claims = { targetId: 'target', sessionId: 'session', deliveryId: 'delivery', provider: 'codex' as const, contentSha256: digest(detail), summarySha256: digest(summary), policySha256: 'a'.repeat(64) };
let root: string;
beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'recon-stage-')); await mkdir(join(root, 'recon')); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });
describe('Recon delivery adapter contract (no CLI model inference)', () => {
  it('signs a bounded, separate-audience ticket and rejects tampering, expiry and command/path input', () => {
    const token = issueReconDelivery(claims, privateKey, 100000);
    expect(verifyReconDelivery(token, publicKey, 101000).provider).toBe('codex');
    expect(() => verifyReconDelivery(token, publicKey, 131000)).toThrow();
    expect(() => verifyReconDelivery(token + 'x', publicKey, 101000)).toThrow();
    expect(() => issueReconDelivery({ ...claims, targetId: '../bad' }, privateKey)).toThrow();
    expect(() => reconDeliveryPrompt('x; shell')).toThrow();
    expect(reconDeliveryPrompt(claims.contentSha256)).not.toContain('IGNORE_SCOPE');
    expect(reconDeliveryPrompt(claims.contentSha256)).toContain('UNTRUSTED');
  });
  it.each(['codex', 'claude'] as const)('stages identical evidence for %s in the existing provider tmux identity, without Enter or config changes', async provider => {
    mocks.workspace.mockImplementation(async () => ({ root: await open(root, 'r'), policy: { sessionId: 'session' }, policySha256: claims.policySha256 }));
    mocks.read.mockImplementation(async (_root, name: string) => name.startsWith('snapshot') ? detail : summary);
    const execute = vi.fn().mockResolvedValue({ stdout: '' }), spent = new Map();
    const token = issueReconDelivery({ ...claims, provider }, privateKey);
    expect(await stageReconContext(token, publicKey, execute, spent)).toMatchObject({ status: 'STAGED', provider });
    const target = provider === 'codex' ? '=bughunter-target' : '=bughunter_claude_target';
    expect(execute.mock.calls).toEqual([
      ['tmux', ['has-session', '-t', target], { timeout: 3000 }],
      ['tmux', ['set-buffer', '-b', 'recon-delivery', '--', reconDeliveryPrompt(claims.contentSha256)], { timeout: 3000 }],
      ['tmux', ['paste-buffer', '-p', '-b', 'recon-delivery', '-t', `${target}:`], { timeout: 3000 }],
      ['tmux', ['delete-buffer', '-b', 'recon-delivery'], { timeout: 3000 }],
    ]);
    expect(JSON.stringify(execute.mock.calls)).not.toMatch(/IGNORE_SCOPE|Enter|send-keys|config\.toml|settings\.json/);
    await expect(stageReconContext(token, publicKey, execute, spent)).rejects.toThrow('REPLAY');
  });
  it('rejects drifted policy, corrupted evidence and absent provider session', async () => {
    const token = issueReconDelivery(claims, privateKey), execute = vi.fn().mockResolvedValue({ stdout: '' });
    mocks.workspace.mockImplementation(async () => ({ root: await open(root, 'r'), policy: { sessionId: 'other' }, policySha256: claims.policySha256 }));
    await expect(stageReconContext(token, publicKey, execute)).rejects.toThrow('POLICY_CHANGED'); expect(execute).not.toHaveBeenCalled();
    mocks.workspace.mockImplementation(async () => ({ root: await open(root, 'r'), policy: { sessionId: 'session' }, policySha256: claims.policySha256 }));
    mocks.read.mockResolvedValue('corrupted'); await expect(stageReconContext(token, publicKey, execute)).rejects.toThrow('INTEGRITY'); expect(execute).not.toHaveBeenCalled();
    mocks.read.mockImplementation(async (_root, name: string) => name.startsWith('snapshot') ? detail : summary);
    execute.mockRejectedValue(new Error('No session')); await expect(stageReconContext(token, publicKey, execute)).rejects.toThrow('No session'); expect(execute).toHaveBeenCalledTimes(1);
  });
  it('reports a paste timeout as uncertain because tmux might have accepted the message', async () => {
    mocks.workspace.mockImplementation(async () => ({ root: await open(root, 'r'), policy: { sessionId: 'session' }, policySha256: claims.policySha256 }));
    mocks.read.mockImplementation(async (_root, name: string) => name.startsWith('snapshot') ? detail : summary);
    const execute = vi.fn().mockImplementation(async (_tool, args: string[]) => { if (args[0] === 'paste-buffer') throw new Error('Timeout'); return { stdout: '' }; });
    await expect(stageReconContext(issueReconDelivery(claims, privateKey), publicKey, execute)).rejects.toMatchObject({ deliveryUncertain: true });
    expect(execute.mock.calls.at(-1)?.[1][0]).toBe('delete-buffer');
  });
});
