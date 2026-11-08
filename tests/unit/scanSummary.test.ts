import { describe, expect, it } from 'vitest';
import { buildScanSummary } from '../../src/lib/scanSummary';

const artifact = (kind: string, tool: string, value: Record<string, unknown>, scopeState = 'IN_SCOPE', verification = 'OBSERVED') => ({
  kind, sources: [{ tool }, { tool }], value, scopeState, verification,
});

describe('scan summary', () => {
  it('orders the recorded signals and aggregates provenance without counting duplicate sources', () => {
    const result = buildScanSummary([
      artifact('endpoint', 'ffuf', { url: 'https://app.example.test/profile?id=secret-value', statusCode: 200 }),
      artifact('port', 'nmap', { hostname: 'app.example.test', port: 8443, protocol: 'tcp', state: 'open' }),
      artifact('observation', 'nuclei', { type: 'nuclei-recon', url: 'https://app.example.test/config', severity: 'high', templateId: 'config-match' }),
    ], 8);

    expect(result.priorities.map(row => row.tools)).toEqual([['nuclei'], ['nmap'], ['ffuf']]);
    expect(result.tools[0].counts).toEqual([['Route HTTP', 1]]);
    expect(result).toMatchObject({ total: 8, analyzed: 3 });
    expect(JSON.stringify(result)).not.toContain('secret-value');
  });

  it('keeps out-of-scope, closed, static and unverified HTTP results out of priorities', () => {
    const result = buildScanSummary([
      artifact('api-surface', 'httpx', { url: 'https://outside.example.test/api' }, 'OUT_OF_SCOPE'),
      artifact('port', 'nmap', { hostname: 'app.example.test', port: 8443, state: 'closed' }),
      artifact('endpoint', 'katana', { url: 'https://app.example.test/app.js', statusCode: 200 }),
      artifact('endpoint', 'gau', { url: 'https://app.example.test/old', statusCode: 200 }, 'IN_SCOPE', 'DISCOVERED'),
    ], 4);

    expect(result.priorities).toEqual([]);
    expect(result.tools).toHaveLength(4);
    expect(result.tools.find(tool => tool.name === 'gau')?.examples[0].observation).not.toContain('HTTP 200');
  });
});
