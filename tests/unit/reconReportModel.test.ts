import { describe, expect, it } from 'vitest';
import { buildReconReportModel, type ReportFacts } from '@/lib/reconReportModel';
import { renderReconReportMarkdown } from '@/lib/reconReportMarkdown';

function facts(overrides: Partial<ReportFacts> = {}): ReportFacts {
  return {
    run: { id: 'run1', status: 'COMPLETED', outcome: 'SUCCESS', createdAt: '2026-11-05T12:00:00Z', startedAt: '2026-11-05T12:00:00Z', finishedAt: '2026-11-05T12:05:00Z' },
    program: {
      companyName: 'Acme Corp', platform: 'HACKERONE', requiredUserAgent: 'BugHunter/1.0 (acme)',
      outOfScope: ['admin.example'], rulesOfEngagement: 'No DoS; test hours 09:00-17:00 UTC', assessmentMode: 'BLACK_BOX',
    },
    authorizedAssets: ['acme.example'],
    scans: [],
    authSurfaces: [],
    ...overrides,
  };
}

function scan(overrides: Partial<ReportFacts['scans'][number]> = {}): ReportFacts['scans'][number] {
  return {
    host: 'acme.example', status: 'COMPLETED', outcome: 'SUCCESS',
    startedAt: '2026-11-05T12:00:00Z', finishedAt: '2026-11-05T12:05:00Z',
    requiredUserAgent: 'BugHunter/1.0 (acme)', authenticatedContexts: 0,
    plan: { stages: [{ name: 'HTTP surface', tools: ['httpx'] }] },
    steps: [{ name: 'HTTP surface', state: 'COMPLETED', reason: null, details: null }],
    artifacts: [], artifactCount: 0, changeSet: null, toolVersions: null,
    ...overrides,
  };
}

describe('deterministic Recon report', () => {
  it('keeps COMPLETED with a null outcome as result unknown', () => {
    const model = buildReconReportModel(facts({ run: { ...facts().run, status: 'COMPLETED', outcome: null } }));
    expect(model.metadata.outcomeLabel).toBe('Result unknown');
    expect(model.metadata.outcomeLabel).not.toBe('Completed');
  });

  it('never invents ports, services or hosts', () => {
    const model = buildReconReportModel(facts({ scans: [scan({
      artifacts: [{ kind: 'endpoint', value: { url: 'https://acme.example/login', statusCode: 200 } }],
    })] }));
    expect(model.network).toEqual([]);
    expect(model.dns).toEqual([]);
    expect(model.portDiscoveryPerformed).toBe(false);
    expect(model.web.endpoints).toHaveLength(1);
    // An HTTPS URL must never be promoted into a 443 port observation.
    expect(model.network.some(row => row.port === 443)).toBe(false);
  });

  it('shows a port only when a port artifact recorded it', () => {
    const model = buildReconReportModel(facts({ scans: [scan({
      plan: { stages: [{ name: 'Ports / services', tools: ['nmap'] }] },
      steps: [{ name: 'Ports / services', state: 'COMPLETED', reason: null, details: null }],
      artifacts: [{ kind: 'port', value: { hostname: 'acme.example', port: 8443, protocol: 'tcp', service: 'https-alt' } }],
    })] }));
    expect(model.network).toEqual([{ host: 'acme.example', port: 8443, protocol: 'tcp', service: 'https-alt', source: 'port artifact' }]);
    expect(model.portDiscoveryPerformed).toBe(true);
  });

  it('lists only tools named in the captured plan and never fabricates commands', () => {
    const model = buildReconReportModel(facts({ scans: [scan({
      steps: [{ name: 'HTTP surface', state: 'COMPLETED', reason: null, details: null }],
      toolVersions: { httpx: '1.6.0' },
    })] }));
    expect(model.tools).toEqual([{ name: 'httpx', version: '1.6.0', invocation: null }]);
    expect(model.tools.every(tool => tool.invocation === null)).toBe(true);
    const markdown = renderReconReportMarkdown(model);
    expect(markdown).toContain('Invocation not recorded');
    expect(markdown).not.toMatch(/httpx -/);
  });

  it('never promotes an observed host into authorization', () => {
    const model = buildReconReportModel(facts({ scans: [scan({
      artifacts: [{ kind: 'subdomain', value: { hostname: 'api.acme.example' } }],
    })] }));
    expect(model.authorization.authorized).toEqual(['acme.example']);
    expect(model.authorization.observed).toContain('api.acme.example');
    expect(model.authorization.authorized).not.toContain('api.acme.example');
    expect(model.researchHandoff.join(' ')).toMatch(/outside the authorized list/);
  });

  it('never renames not-observed to removed', () => {
    const model = buildReconReportModel(facts({ scans: [scan({ changeSet: { comparable: true, new: [], changed: [], notObserved: [{}, {}], unchanged: [{}] } })] }));
    expect(model.changes).toMatchObject({ comparable: true, new: 0, changed: 0, notObserved: 2, unchanged: 1 });
    const markdown = renderReconReportMarkdown(model);
    expect(markdown).toContain('Not observed');
    expect(markdown).toMatch(/not proof of removal/i);
    expect(markdown.toLowerCase()).not.toContain('removed');
  });

  it('keeps limitations distinct from success', () => {
    const model = buildReconReportModel(facts({ run: { ...facts().run, status: 'COMPLETED', outcome: 'PARTIAL' }, scans: [scan({
      status: 'COMPLETED', outcome: 'PARTIAL',
      steps: [
        { name: 'HTTP surface', state: 'FAILED', reason: 'httpx exited with code 1', details: null },
        { name: 'Nuclei Recon', state: 'SKIPPED_UNSUPPORTED', reason: 'Template bundle unavailable', details: null },
        { name: 'Content discovery', state: 'SKIPPED_NOT_APPLICABLE', reason: null, details: null },
      ],
    })] }));
    expect(model.metadata.outcomeLabel).toBe('Partial');
    expect(model.limitations.map(item => item.label)).toEqual(['Failed', 'Unsupported', 'Not applicable']);
    expect(model.limitations[0].reason).toContain('exited with code 1');
    expect(model.metadata.stageCounts).toMatchObject({ failed: 1, skipped: 2, completed: 0 });
  });

  it('does not imply authenticated coverage when none was recorded', () => {
    const model = buildReconReportModel(facts({ scans: [scan()] }));
    expect(model.authenticated.contexts).toEqual([]);
    expect(model.authenticated.note).toMatch(/does not imply authenticated coverage/);
    expect(model.methodology.authenticated).toBe(false);
  });

  it('redacts credentials that appear inside recorded values', () => {
    const model = buildReconReportModel(facts({ scans: [scan({
      artifacts: [
        { kind: 'endpoint', value: { url: 'https://acme.example/cb?access_token=supersecrettoken' } },
        { kind: 'endpoint', value: { url: 'https://acme.example/x', method: 'Authorization: Bearer abc123def456' } },
      ],
    })] }));
    const markdown = renderReconReportMarkdown(model);
    expect(markdown).not.toContain('supersecrettoken');
    expect(markdown).not.toContain('abc123def456');
    expect(JSON.stringify(model)).not.toContain('supersecrettoken');
  });

  it('renders an empty run without fabricating sections', () => {
    const model = buildReconReportModel(facts({ scans: [] }));
    const markdown = renderReconReportMarkdown(model);
    expect(markdown).toContain('No stage detail was recorded for this run.');
    expect(markdown).toContain('Port discovery was not performed for this run.');
    expect(markdown).toContain('No host or DNS observation was recorded.');
    expect(markdown).not.toContain('| 443 |');
  });

  it('escapes table-breaking characters in markdown', () => {
    const model = buildReconReportModel(facts({ scans: [scan({
      steps: [{ name: 'HTTP surface', state: 'PARTIAL', reason: 'pipe | breaks | table', details: null }],
    })] }));
    const markdown = renderReconReportMarkdown(model);
    expect(markdown).toContain('pipe \\| breaks \\| table');
  });

  it('never claims the target is secure', () => {
    const markdown = renderReconReportMarkdown(buildReconReportModel(facts({ scans: [scan()] })));
    expect(markdown).not.toMatch(/is secure|no vulnerabilities exist|proves? safety/i);
    expect(markdown).toContain('does not prove security');
  });
});
