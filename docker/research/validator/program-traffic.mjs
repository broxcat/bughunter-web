
const endpoint = 'http://web:3000/api/internal/research-traffic';

export async function acquireResearchTraffic(policy, tool, url) {
  if (!policy.trafficCapability) throw new Error('TOOL_NOT_ALLOWED');
  const request = payload => fetch(endpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
    headers: { Authorization: 'Bearer ' + policy.trafficCapability, 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetId: policy.targetId, ...payload }),
  });
  const response = await request({ action: 'acquire', tool, url });
  if (!response.ok) throw new Error('TOOL_NOT_ALLOWED');
  const { headers, lease, signature } = await response.json();
  if (!headers?.['user-agent'] || typeof lease !== 'string' || typeof signature !== 'string') throw new Error('TOOL_NOT_ALLOWED');
  return {
    headers,
    release: async () => { await request({ action: 'release', lease, signature }).catch(() => {}); },
  };
}

export function mergeResearchHeaders(supplied, required) {
  const headers = new Headers(supplied);
  for (const [name, value] of Object.entries(required)) headers.set(name, value);
  return Object.fromEntries(headers);
}
