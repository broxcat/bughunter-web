import { describe, expect, it } from 'vitest';
import {
  capabilityRows,
  elapsed,
  formatDuration,
  groupObservationKinds,
  redactLogLines,
  stageTools,
  stepView,
} from '@/lib/reconTimeline';

describe('Recon execution timeline', () => {
  it.each([
    ['COMPLETED', 'Completed', 'success', false],
    ['COMPLETED_WITH_FALLBACK', 'Completed (fallback)', 'success', false],
    ['PARTIAL', 'Partial', 'warning', true],
    ['BLOCKED', 'Blocked', 'warning', true],
    ['FAILED', 'Failed', 'danger', true],
    ['SKIPPED', 'Skipped', 'idle', true],
    ['SKIPPED_UNSUPPORTED', 'Unsupported', 'idle', true],
    ['SKIPPED_NOT_APPLICABLE', 'Not applicable', 'idle', true],
    ['CANCELLED', 'Cancelled', 'idle', true],
    ['PENDING', 'Pending', 'idle', false],
    ['RUNNING', 'Running', 'active', false],
  ] as const)('maps %s to %s', (state, label, tone, limitation) => {
    const view = stepView(state);
    expect(view.label).toBe(label);
    expect(view.tone).toBe(tone);
    expect(view.limitation).toBe(limitation);
    expect(view.symbol.length).toBeGreaterThan(0);
  });

  it('keeps an unrecognised persisted state explicit instead of guessing', () => {
    expect(stepView('SOMETHING_NEW')).toEqual({ label: 'Unknown', symbol: '?', tone: 'idle', limitation: false });
    expect(stepView(null).label).toBe('Unknown');
  });

  it('reads tools only from the recorded execution plan', () => {
    const plan = { stages: [{ name: 'HTTP surface', tools: ['httpx'] }] };
    expect(stageTools('HTTP surface', plan)).toEqual(['httpx']);
    expect(stageTools('Missing stage', plan)).toEqual([]);
    expect(stageTools('HTTP surface', null)).toEqual([]);
    expect(stageTools('HTTP surface', { stages: [{ name: 'HTTP surface', tools: ['httpx', '', null as unknown as string] }] })).toEqual(['httpx']);
  });

  it('formats durations without inventing missing values', () => {
    expect(formatDuration(450)).toBe('450 ms');
    expect(formatDuration(1500)).toBe('1.5 s');
    expect(formatDuration(90_000)).toBe('1 min 30 s');
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(-1)).toBeNull();
    expect(formatDuration(Number.NaN)).toBeNull();
    expect(elapsed('2026-01-01T00:00:00Z', '2026-01-01T00:02:00Z')).toBe('2 min 0 s');
    expect(elapsed('2026-01-01T00:02:00Z', '2026-01-01T00:00:00Z')).toBeNull();
    expect(elapsed(null, '2026-01-01T00:00:00Z')).toBeNull();
  });

  it('reads capability rows defensively from stored step details', () => {
    expect(capabilityRows({ capabilities: [{ capability: 'HTTP_SURFACE', state: 'COMPLETED' }] })).toEqual([
      { capability: 'HTTP_SURFACE', state: 'COMPLETED' },
    ]);
    expect(capabilityRows({ capabilities: [{ state: 'COMPLETED' }, null, 'x'] })).toEqual([]);
    expect(capabilityRows(null)).toEqual([]);
    expect(capabilityRows({ capabilities: 'nope' })).toEqual([]);
  });

  it('groups only observed artifact kinds and keeps the rest verbatim', () => {
    const groups = groupObservationKinds([
      { kind: 'endpoint', count: 12 },
      { kind: 'technology', count: 3 },
      { kind: 'weird-kind', count: 1 },
    ]);
    expect(groups.map(group => group.label)).toEqual(['URLs and endpoints', 'Technologies', 'Other observations']);
    expect(groups[0].count).toBe(12);
    expect(groups[2].kinds).toEqual([{ kind: 'weird-kind', count: 1 }]);
    expect(groupObservationKinds([])).toEqual([]);
  });

  it('redacts credentials before raw output reaches the DOM', () => {
    const [authorization, cookie, jwt, plain] = redactLogLines([
      { line: 'Authorization: Bearer abc123def456', stream: 'STDOUT' },
      { line: 'Cookie: session=supersecretvalue', stream: 'STDOUT' },
      { line: 'token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature', stream: 'STDERR' },
      { line: 'httpx: 8 responsive URLs', stream: 'STDOUT' },
    ]);
    expect(authorization.text).not.toMatch(/abc123def456/);
    expect(cookie.text).not.toMatch(/supersecretvalue/);
    expect(jwt.text).not.toMatch(/eyJhbGciOiJIUzI1NiJ9/);
    expect(jwt.stream).toBe('STDERR');
    expect(plain.text).toBe('httpx: 8 responsive URLs');
  });
});
