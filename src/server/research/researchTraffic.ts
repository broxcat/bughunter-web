
import { createHmac, timingSafeEqual } from 'node:crypto';

export function researchTrafficCapability(targetId: string, sessionId: string, userId: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return undefined;
  return createHmac('sha256', secret).update(JSON.stringify(['research-traffic-v1', targetId, sessionId, userId])).digest('hex');
}

export function trafficCapabilityMatches(received: string, expected: string | undefined) {
  return expected !== undefined && /^[a-f0-9]{64}$/.test(received) &&
    timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
}

export function researchLeaseSignature(capability: string, lease: string) {
  // Include a server-only key. A workspace can release only leases actually
  // issued to it, even when it shares a program with other workspaces.
  return createHmac('sha256', process.env.AUTH_SECRET!).update(JSON.stringify(['research-traffic-lease-v1', capability, lease])).digest('hex');
}
