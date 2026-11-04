import { describe, expect, it } from 'vitest';
import { withScanDispatch } from '@/lib/scanDispatch';

describe('scan response authentication privacy', () => {
  it('never spreads private captured authentication metadata through scan APIs', () => {
    const result = withScanDispatch({ id: 'scan', status: 'COMPLETED', jobOutbox: { status: 'PUBLISHED' }, authenticatedContextsSnapshot: { credentialId: 'private-record', sessionIdentityHash: 'private-identity', validationUrl: 'private-validation' }, authenticatedReconResult: { contexts: [{ contextKey: 'private-context' }] } });
    expect(result).toEqual({ id: 'scan', status: 'COMPLETED', dispatch: 'PUBLISHED', execution: null });
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('preserves historical dispatch and execution views without a captured authentication context', () => {
    expect(withScanDispatch({ id: 'legacy', executionAttempts: [{ id: 'attempt', state: 'FINISHED', reason: null }] })).toEqual({ id: 'legacy', dispatch: null, execution: { id: 'attempt', state: 'FINISHED', reason: null } });
  });
});
