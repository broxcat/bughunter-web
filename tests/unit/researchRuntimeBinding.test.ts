import { describe, it, expect } from 'vitest';
import { checkRuntimeBinding, readRuntimeBinding } from '../../docker/research/validator/runtime-binding.mjs';

const a = { v: 1, uid: 200001, gid: 200001, targetId: 'a', workspaceId: 'research_a', sessionId: 'session_a', policySha256: 'a'.repeat(64), state: 'active' };
const context = { uid: 200001, gid: 200001, policy: { targetId: 'a', workspaceId: 'research_a', sessionId: 'session_a' }, policySha256: a.policySha256 };

describe('trusted runtime binding contract (not runtime integration acceptance)', () => {
  it('accepts an exact identity', () => { expect(checkRuntimeBinding(a, context).targetId).toBe('a'); });
  it.each([
    { ...a, targetId: 'b', workspaceId: 'research_b' },
    { ...a, sessionId: 'session_b' },
    { ...a, policySha256: 'b'.repeat(64) },
    { ...a, state: 'revoked' },
    { ...a, workspaceId: 'research_b' },
    { ...a, uid: 200002, gid: 200002 },
    { ...a, extra: 'caller supplied authority' },
  ])('rejects foreign, stale, revoked or forged records %#', binding => {
    expect(() => checkRuntimeBinding(binding, context)).toThrow('RESEARCH_IDENTITY_DENIED');
  });
  it('rejects the common legacy identity', async () => {
    await expect(readRuntimeBinding()).rejects.toThrow('RESEARCH_IDENTITY_DENIED');
  });
});
