import Link from 'next/link';
import { assetValueRank,assetValueLabel,type AssetValue } from '@/lib/scopeAssets';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { assertResearchTarget, researchTargetSelect } from '@/server/research/workspace';
import { ownedResearch } from '@/server/research/sessions';
export default async function ResearchPage({searchParams}:{searchParams:Promise<{program?:string}>}) {
  const filter=(await searchParams).program;
  const session = await auth(); if (!session?.user?.id) return null;
  const targets = await prisma.target.findMany({ where: { userId: session.user.id, ...(filter?{programId:filter}:{}), OR:[{active:true},{scopeAsset:{active:true}}], program: { ownerId: session.user.id } }, select: { ...researchTargetSelect, researchSessions: { where: { consoleTargetId: { not: null } }, select: { status: true }, take: 1 }, scanRuns: { where: { type: 'RECON' }, orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, outcome: true } } }, orderBy: [{ host: 'asc' }], take: 500 });
  const available = targets.filter(t => { try { assertResearchTarget(t, session.user.id); return true; } catch { return false; } }).sort((a,b)=>assetValueRank((a.scopeAsset??a.discoveredFromAsset)?.assetValue??'MEDIUM')-assetValueRank((b.scopeAsset??b.discoveredFromAsset)?.assetValue??'MEDIUM')||a.host.localeCompare(b.host));
  const history = await prisma.researchSession.findMany({ where: { ...ownedResearch(session.user.id), consoleTargetId: null }, select: { id: true, targetHost: true, programName: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 50 });
  return <div className="space-y-6"><h1 className="text-2xl font-semibold">Research</h1>
    <p>Review Scope intelligence, then open an existing persistent Codex or Claude console.</p>
    {!available.length && <p>Configure an authorized asset in <Link href="/scopes" className="text-brand">Scope</Link>.</p>}
    <ul className="space-y-3">{available.map(t => <li key={t.id} className="flex flex-wrap items-center gap-4 rounded border border-border p-4"><div className="mr-auto"><p>{t.program!.companyName}</p><h2 className="font-mono">{t.host}</h2><p className="text-sm text-muted">{assetValueLabel[((t.scopeAsset??t.discoveredFromAsset)?.assetValue??'MEDIUM') as AssetValue]}</p><p className="text-sm text-muted">Recon: {t.scanRuns[0]?.status ?? 'not run'} {t.scanRuns[0]?.outcome ?? ''} · Workspace: {t.researchSessions[0]?.status ?? 'created on first open'}</p></div><Link href={`/research/${t.id}`} className="text-brand" aria-label={`Open console — ${t.host}`}>Open console</Link></li>)}</ul>
    {history.length > 0 && <details><summary>Historical Research Sessions</summary><ul className="space-y-2 pt-3">{history.map(s => <li key={s.id}><Link className="text-brand" href={`/research/history/${s.id}`}>{s.programName} / {s.targetHost} · {s.createdAt.toISOString()}</Link></li>)}</ul></details>}
    <Link href="/hunt" className="text-sm text-muted">Legacy Hunt history</Link>
  </div>;
}
