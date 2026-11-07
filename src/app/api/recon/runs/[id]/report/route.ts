import {readRunNarrative} from '@/server/recon/runNarrative';
import { auth } from '@/lib/auth';
import { loadReconReportFacts } from '@/server/recon/reportFacts';
import { buildReconReportModel } from '@/lib/reconReportModel';
import { renderReconReportMarkdown } from '@/lib/reconReportMarkdown';
import { ResearchError } from '@/server/research/workspace';

type Params = { params: Promise<{ id: string }> };

/** Markdown export of the deterministic report. No AI, no secrets. */
export async function GET(_req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    const facts = await loadReconReportFacts(session.user.id, id);
    const model = buildReconReportModel(facts);
    const markdown = renderReconReportMarkdown(model,await readRunNarrative(session.user.id,facts,model));
    const slug = facts.program.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'target';
    return new Response(markdown, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="recon-report-${slug}.md"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof ResearchError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: 'Report unavailable' }, { status: 500 });
  }
}
