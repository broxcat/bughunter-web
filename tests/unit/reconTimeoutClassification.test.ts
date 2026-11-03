import { describe, expect, it } from 'vitest';
import { classifyReconFailure, reconRetryDelay } from '@/lib/reconCapabilities';

describe('real platform timeout/cancellation taxonomy', () => {
  it('classifies AbortSignal.timeout reason as transient TIMEOUT despite aborted wording', async () => {
    const signal = AbortSignal.timeout(1);
    await new Promise<void>(resolve => setTimeout(resolve, 5));
    expect(signal.aborted).toBe(true);
    expect(signal.reason.name).toBe('TimeoutError');
    const failure = classifyReconFailure(signal.reason, 'HTTP_DISCOVERY', 'guarded-http');
    expect(failure).toMatchObject({ reason: 'TIMEOUT', retryable: true, category: 'TARGET' });
    expect(reconRetryDelay(failure, 0)).toBe(250);
  });

  it('retains explicit AbortError as non-retryable cancellation', () => {
    const control = new AbortController(); control.abort();
    const failure = classifyReconFailure(control.signal.reason, 'CONTENT_DISCOVERY', 'ffuf');
    expect(failure).toMatchObject({ reason: 'CANCELLED', retryable: false, category: 'POLICY' });
    expect(reconRetryDelay(failure, 0)).toBeNull();
  });

  it('keeps ordinary transport timeout and immutable typed scope failures distinct', () => {
    expect(classifyReconFailure(new Error('read ETIMEDOUT'), 'HTTP_DISCOVERY').reason).toBe('TIMEOUT');
    expect(classifyReconFailure(new Error('SCOPE_BLOCKED: authorization revoked'), 'HTTP_DISCOVERY')).toMatchObject({ reason: 'SCOPE_BLOCKED', retryable: false });
  });
});
