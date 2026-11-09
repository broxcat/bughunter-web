import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { paginationBounds, type PageRequest } from '@/lib/pagination';
import CollectionPager from './CollectionPager';

const observed = z.object({ status: z.literal('OBSERVED'), method: z.enum(['GET', 'HEAD']),
  url: z.string(), previousStatus: z.number().nullable(), statusCode: z.number(),
  authChallenge: z.boolean(), setsCookie: z.boolean(), hsts: z.boolean(), contentSecurityPolicy: z.boolean(),
  redirect: z.enum(['none', 'same origin', 'different origin', 'unparseable']),
});
const result = z.object({ version: z.literal(1), note: z.string().nullable(), entries: z.array(z.object({
  objectiveId: z.string(), result: z.union([observed, z.object({ status: z.enum(['NOT_TESTED', 'UNAVAILABLE']), reason: z.string() })]),
})).max(100) });

export default async function AutomatedResearchResults({ ownerId, programId, handoffId, input, query }: {
  ownerId: string; programId: string; handoffId: string; input: PageRequest; query: string;
}) {
  const where = { type: 'RESEARCH' as const, researchHandoffId: handoffId,
    target: { userId: ownerId, programId, program: { ownerId } }, NOT: { status: 'CANCELLED' as const, startedAt: null },
  };
  const bounds = paginationBounds({ ...input, pageSize: Math.min(input.pageSize, 20) }, await prisma.scanRun.count({ where }));
  const jobs = await prisma.scanRun.findMany({ where, skip: bounds.skip, take: bounds.pageSize,
    orderBy: [{ target: { host: 'asc' } }, { id: 'asc' }], select: {
      id: true, status: true, outcome: true, error: true, researchResults: true,
      target: { select: { host: true } },
      executedResearchPlan: { select: { methodologyVersion: true, items: { select: { id: true, title: true, objective: true }, take: 100 } } },
    } });
  return <section aria-label="Automatic Research results" className="space-y-4">
    <h2 className="text-lg font-semibold">Automatic checks</h2>
    <p className="text-sm text-muted">Observations are for review. They do not establish a vulnerability or show that a surface is safe.</p>
    {!jobs.length && <p className="text-sm">No automatic checks have been recorded for this Recon run.</p>}
    {jobs.length > 0 && <CollectionPager path="/research" query={query} {...bounds} label="Automatic Research results pages" noun="Research jobs" />}
    {jobs.map(job => {
      const data = result.safeParse(job.researchResults).data;
      const observations = data?.entries.filter(entry => entry.result.status === 'OBSERVED').length ?? 0;
      const objectives = new Map(job.executedResearchPlan?.items.map(item => [item.id, item]));
      const status = job.status === 'COMPLETED' ? job.outcome === 'PARTIAL' ? 'Partial coverage' : 'Done'
        : job.status.charAt(0) + job.status.slice(1).toLowerCase();
      return <details key={job.id} className="ui-disclosure">
        <summary>{job.target.host} · {status} · {observations} {observations === 1 ? 'observation' : 'observations'}</summary>
        <div className="mt-3 space-y-3 text-sm">
          {(data?.note || job.error) && <p>{data?.note ?? job.error}</p>}
          {job.executedResearchPlan && <p className="text-muted">Captured plan · {job.executedResearchPlan.methodologyVersion}</p>}
          <ul className="space-y-3">
            {data?.entries.map(({ objectiveId, result }) => <li key={objectiveId} className="border-t border-border pt-3">
              <p className="font-medium">{objectives.get(objectiveId)?.title ?? 'Plan objective'}</p>
              {objectives.get(objectiveId) && <p className="text-muted">{objectives.get(objectiveId)?.objective}</p>}
              {result.status === 'OBSERVED' ? <div className="break-words">
                <p>{result.method} {result.url} · HTTP {result.statusCode}{result.previousStatus !== null ? ' · Recon HTTP ' + result.previousStatus : ''}</p>
                <p>Redirect {result.redirect} · Authentication challenge {result.authChallenge ? 'present' : 'absent'} · Set-Cookie {result.setsCookie ? 'present' : 'absent'}</p>
                <p>HSTS {result.hsts ? 'present' : 'absent'} · Content Security Policy {result.contentSecurityPolicy ? 'present' : 'absent'}</p>
              </div> : <p>{result.status === 'NOT_TESTED' ? 'Not tested' : 'Unavailable'} · {result.reason}</p>}
            </li>)}
          </ul>
        </div>
      </details>;
    })}
  </section>;
}
