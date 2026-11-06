import { describe, expect, it } from 'vitest';
import { needsFirstRecon, reconOverview } from '@/lib/reconOverview';

describe('Recon overview state', () => {
  it('reports a Target that has never run Recon', () => {
    expect(reconOverview(null)).toEqual({ label: 'Not run', tone: 'idle', detail: null });
    expect(reconOverview(undefined)).toEqual({ label: 'Not run', tone: 'idle', detail: null });
  });

  it('keeps in-flight runs distinct from finished ones', () => {
    expect(reconOverview({ status: 'QUEUED', outcome: null }).label).toBe('Queued');
    expect(reconOverview({ status: 'RUNNING', outcome: null }).label).toBe('Running');
    expect(reconOverview({ status: 'RUNNING', outcome: null }).tone).toBe('active');
  });

  it('never infers success from a completed job alone', () => {
    const unknown = reconOverview({ status: 'COMPLETED', outcome: null });
    expect(unknown.label).toBe('Result unknown');
    expect(unknown.tone).not.toBe('success');
    expect(unknown.detail).toMatch(/without a recorded outcome/i);
  });

  it.each([
    ['SUCCESS', 'Completed', 'success'],
    ['PARTIAL', 'Partial', 'warning'],
    ['FAILED', 'Failed', 'danger'],
    ['UNSUPPORTED', 'Unsupported', 'warning'],
  ] as const)('maps completed outcome %s to %s', (outcome, label, tone) => {
    const view = reconOverview({ status: 'COMPLETED', outcome });
    expect(view.label).toBe(label);
    expect(view.tone).toBe(tone);
  });

  it('shows a cancelled run as cancelled rather than failed', () => {
    const view = reconOverview({ status: 'CANCELLED', outcome: null });
    expect(view.label).toBe('Cancelled');
    expect(view.tone).toBe('idle');
  });

  it('shows a failed job as failed even without an outcome', () => {
    expect(reconOverview({ status: 'FAILED', outcome: null }).label).toBe('Failed');
  });

  it('flags targets with authorized assets but no Recon run', () => {
    expect(needsFirstRecon(2, null)).toBe(true);
    expect(needsFirstRecon(0, null)).toBe(false);
    expect(needsFirstRecon(2, { status: 'QUEUED', outcome: null })).toBe(false);
  });
});
