import ResearchLauncher from '@/components/ResearchLauncher';
import CollectionPager from '@/components/CollectionPager';
import { paginationInput,paginationBounds } from '@/lib/pagination';
import ResearchCoverage from '@/components/ResearchCoverage';
import DeleteResourceButton from '@/components/DeleteResourceButton';
import ResearchPlan from '@/components/ResearchPlan';
import Link from 'next/link';
import { assetValueLabel,type AssetValue } from '@/lib/scopeAssets';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { assertResearchTarget, researchAuthorizationMatches, researchTargetSelect } from '@/server/research/workspace';
import { ownedResearch } from '@/server/research/sessions';
export default async function ResearchPage({searchParams}:{searchParams:Promise<{program?:string;page?:string;pageSize?:string;q?:string;historyPage?:string}>}) {
  const search=await searchParams, filter=search.program;
  const query=new URLSearchParams(Object.entries(search).filter((e):e is [string,string]=>typeof e[1]==='string'));
  const input=paginationInput(query,false);
  const historyInput=paginationInput(new URLSearchParams({page:search.historyPage??'1',pageSize:String(input.pageSize)}),false);
  const session=await auth();if(!session?.user?.id)return null;
  const userId=session.user.id;
  const result=await prisma.$transaction(async tx=>{
    const where={userId,...(filter?{programId:filter}:{}),OR:[{active:true},{scopeAsset:{active:true}}],program:{ownerId:userId},...(input.q?{host:{contains:input.q,mode:'insensitive' as const}}:{})};
    const bounds=paginationBounds(input,await tx.target.count({where}));
    // These are owned candidate hosts, not an authorization list. Current
    // policy is still checked below and by the trusted console launcher.
    const targets=await tx.target.findMany({where,skip:bounds.skip,take:bounds.pageSize,
      select:{...researchTargetSelect,researchSessions:{where:{consoleTargetId:{not:null}},select:{status:true,authorizationSnapshot:true},orderBy:[{createdAt:'desc'},{id:'desc'}],take:1},
        scanRuns:{where:{type:'RECON'},orderBy:[{createdAt:'desc'},{id:'desc'}],take:1,select:{id:true,status:true,outcome:true}},
        researchPlans:{where:{status:'CURRENT'},orderBy:[{createdAt:'desc'},{id:'desc'}],take:1,select:{scanRunId:true,items:{where:{status:'READY'},select:{priority:true}}}}},
      orderBy:[{host:'asc'},{id:'asc'}]});
    const historyWhere={...ownedResearch(userId),consoleTargetId:null,...(filter?{target:{...ownedResearch(userId).target,programId:filter}}:{}),...(input.q?{targetHost:{contains:input.q,mode:'insensitive' as const}}:{})};
    const historyBounds=paginationBounds(historyInput,await tx.researchSession.count({where:historyWhere}));
    const history=await tx.researchSession.findMany({where:historyWhere,select:{id:true,targetHost:true,programName:true,createdAt:true},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:historyBounds.skip,take:historyBounds.pageSize});
    return{bounds,targets,historyBounds,history};
  },{isolationLevel:'RepeatableRead'});
  const available=result.targets.filter(t=>{try{if(t.consoleDeletingAt)return true;assertResearchTarget(t,userId);return true;}catch{return false;}}),history=result.history;
  return <div className="space-y-6"><h1 className="text-2xl font-semibold">Research</h1>
    <p>Open an authorized host console and use its Research plan to map the surface, prepare tests and review evidence.</p>
    <form action="/research" className="flex flex-wrap gap-3"><label>Search hosts<input name="q" defaultValue={input.q} maxLength={200} className="ml-2 rounded border border-border bg-surface p-2"/></label><input type="hidden" name="program" value={filter??''}/><input type="hidden" name="pageSize" value={input.pageSize}/><button className="ui-btn" type="submit">Search</button></form>
    <CollectionPager path="/research" query={query.toString()} {...result.bounds} label="Research hosts pages" noun="owned host candidates"/>
    <p className="text-sm text-muted">Hosts are ordered by hostname. Only currently authorized consoles appear on each page; unavailable candidates remain excluded. Continue through the pages to review other hosts.</p>
    {!available.length && <p>No authorized consoles on this page. Configure an authorized asset in <Link href="/scopes" className="text-brand">Scope</Link>.</p>}
    <ul className="space-y-3">{available.map(t => <li key={t.id} className="flex flex-wrap items-center gap-4 rounded border border-border p-4"><div className="mr-auto"><p>{t.program!.companyName}</p><p className="text-sm text-muted">Scope: currently authorized; checked again on open</p><h2 className="font-mono">{t.host}</h2><p className="text-sm text-muted">{assetValueLabel[((t.scopeAsset??t.discoveredFromAsset)?.assetValue??'MEDIUM') as AssetValue]}</p><p className="text-sm text-muted">Recon: {t.scanRuns[0]?.status ?? 'not run'} {t.scanRuns[0]?.outcome ?? ''} · Workspace: {t.researchSessions[0]?.status ?? 'created on first open'}</p></div><ResearchPlan targetId={t.id} compact initialSummary={t.researchPlans[0]?{objectives:t.researchPlans[0].items.length,high:t.researchPlans[0].items.filter(item=>item.priority==='HIGH').length,reconCurrent:t.scanRuns[0]?.id===t.researchPlans[0].scanRunId&&t.scanRuns[0]?.status==='COMPLETED'}:undefined}/><ResearchCoverage targetId={t.id} compact/><ResearchLauncher targetId={t.id} host={t.host} disabledReason={t.consoleDeletingAt?'Workspace cleanup is pending. Retry the existing cleanup action.':t.researchSessions[0]&&!researchAuthorizationMatches(t.researchSessions[0].authorizationSnapshot,t)?'Policy: stale. Preserve evidence, then recreate the console using the existing workspace removal flow. Reconnect never rewrites authorization.':undefined}/><DeleteResourceButton kind="console" name={t.host} url={`/api/research-targets/${t.id}/console`}/></li>)}</ul>
    {<details open={Boolean(search.historyPage)}><summary>Historical Research Sessions</summary><CollectionPager path="/research" query={query.toString()} {...result.historyBounds} pageKey="historyPage" label="Research history pages"/>{!history.length&&<p>No historical sessions match this view.</p>}<ul className="space-y-2 pt-3">{history.map(s => <li key={s.id}><Link className="text-brand" href={`/research/history/${s.id}`}>{s.programName} / {s.targetHost} · {s.createdAt.toISOString()}</Link></li>)}</ul></details>}
    <details><summary>Archived Hunt runs</summary><Link href="/hunt" className="text-sm text-muted">View historical results</Link></details>
  </div>;
}
