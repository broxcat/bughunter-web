
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { targetIdentity } from '@/lib/research/identity';
import { assertLiveExecution, loadTargetExecution } from '@/server/execution';
import { authorizeExecution } from '@/server/programExecutionPolicy';
import { acquireProgramTraffic, releaseProgramTraffic } from '@/server/programTraffic';
import { researchLeaseSignature, researchTrafficCapability, trafficCapabilityMatches } from '@/server/research/researchTraffic';

const requestSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('acquire'), targetId: targetIdentity, tool: z.enum(['research-http', 'research-browser']), url: z.string().max(8192).url() }),
  z.strictObject({ action: z.literal('release'), targetId: targetIdentity, lease: z.uuid(), signature: z.string().regex(/^[a-f0-9]{64}$/) }),
]);

export async function POST(request: Request) {
  const capability = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!capability) return new Response(null, { status: 401 });
  const text = await request.text().catch(() => '');
  if (text.length > 10_000) return new Response(null, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return new Response(null, { status: 400 }); }
  const input = requestSchema.safeParse(body);
  if (!input.success) return new Response(null, { status: 400 });
  const { targetId } = input.data;
  const session = await prisma.researchSession.findUnique({
    where: { consoleTargetId: targetId },
    select: { id: true, userId: true, status: true, target: { select: { programId: true, consoleDeletingAt: true, contextOnly: true } } },
  });
  if (!session?.target.programId || !trafficCapabilityMatches(capability, researchTrafficCapability(targetId, session.id, session.userId))) {
    return new Response(null, { status: 403 });
  }
  const programId = session.target.programId;
  if (input.data.action === 'release') {
    const { lease, signature } = input.data;
    if (!trafficCapabilityMatches(signature, researchLeaseSignature(capability, lease))) return new Response(null, { status: 403 });
    await releaseProgramTraffic(programId, lease);
    return new Response(null, { status: 204 });
  }
  if (session.status !== 'READY' || session.target.consoleDeletingAt || session.target.contextOnly) return new Response(null, { status: 403 });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(4000)]);
  let lease: string | undefined;
  try {
    const execution = await loadTargetExecution(targetId);
    if (execution.programId !== programId || !execution.policy || execution.programReconId) throw new Error('Scope changed');
    authorizeExecution(execution, input.data);
    lease = await acquireProgramTraffic(programId, execution.policy.limits, signal);
    await assertLiveExecution(execution);
    signal.throwIfAborted();
    return Response.json({ lease, signature: researchLeaseSignature(capability, lease), headers: { ...execution.policy.headers, 'user-agent': execution.requiredUserAgent } },
      { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    if (lease) await releaseProgramTraffic(programId, lease).catch(() => {});
    return new Response(null, { status: 403 });
  }
}
