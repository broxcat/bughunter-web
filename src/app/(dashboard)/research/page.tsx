import CollectionPager from '@/components/CollectionPager';
import { paginationInput,paginationBounds } from '@/lib/pagination';
import ResearchCoverage from '@/components/ResearchCoverage';
import ResearchPlan from '@/components/ResearchPlan';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadTargetCampaign } from '@/server/targetCampaign';
import { CampaignState } from '@/components/TargetCampaignView';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { assertResearchTarget, researchTargetSelect } from '@/server/research/workspace';
import { ownedResearch } from '@/server/research/sessions';
export default async function ResearchPage({searchParams}:{searchParams:Promise<{program?:string;page?:string;pageSize?:string;q?:string;historyPage?:string;view?:string}>}) {
  const search=await searchParams, filter=search.program;
  const query=new URLSearchParams(Object.entries(search).filter((e):e is [string,string]=>typeof e[1]==='string'));
  const input=paginationInput(query,false);
  const historyInput=paginationInput(new URLSearchParams({page:search.historyPage??'1',pageSize:String(input.pageSize)}),false);
  const session=await auth();if(!session?.user?.id)return null;
  const userId=session.user.id;
  if (filter && search.view === 'campaign') {
    const campaign = await loadTargetCampaign(userId, filter);
    if (!campaign) notFound();
    const stage = campaign.view.stages[2];
    return <div className="max-w-3xl space-y-5">
      <Link href={'/targets/' + filter} className="text-sm text-brand">← {campaign.program.companyName}</Link>
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold">Research</h1><CampaignState state={stage.state} /></div>
      {stage.detail && <p className="text-sm text-muted">{stage.detail}</p>}
      <p>Research runs manually in your local CLI. Download the handoff and the authorized scope, then record Findings here.</p>
      <div className="flex flex-wrap gap-4">
        {campaign.view.campaign?.handoffRunId && <a className="text-brand underline" href={'/api/programs/' + filter + '/campaign/handoff'}>Download prepared handoff</a>}
        <a className="text-brand underline" href={'/api/programs/' + filter + '/scope.md'}>Download scope.md</a>
        <Link className="text-brand underline" href={'/research?program=' + filter + '&view=details'} prefetch={false}>View details</Link>
      </div>
    </div>;
  }
  const result=await prisma.$transaction(async tx=>{
    const where={userId,...(filter?{programId:filter}:{}),OR:[{active:true},{scopeAsset:{active:true}}],program:{ownerId:userId},...(input.q?{host:{contains:input.q,mode:'insensitive' as const}}:{})};
    const bounds=paginationBounds(input,await tx.target.count({where}));
    // These are owned candidate hosts, not an authorization list. Current
    // policy is still checked below.
    const targets=await tx.target.findMany({where,skip:bounds.skip,take:bounds.pageSize,
      select:{...researchTargetSelect,
        scanRuns:{where:{type:'RECON'},orderBy:[{createdAt:'desc'},{id:'desc'}],take:1,select:{id:true,status:true,outcome:true}},
        researchPlans:{where:{status:'CURRENT'},orderBy:[{createdAt:'desc'},{id:'desc'}],take:1,select:{scanRunId:true,items:{where:{status:'READY'},select:{priority:true}}}}},
      orderBy:[{host:'asc'},{id:'asc'}]});
    const historyWhere={...ownedResearch(userId),...(filter?{target:{...ownedResearch(userId).target,programId:filter}}:{}),...(input.q?{targetHost:{contains:input.q,mode:'insensitive' as const}}:{})};
    const historyBounds=paginationBounds(historyInput,await tx.researchSession.count({where:historyWhere}));
    const history=await tx.researchSession.findMany({where:historyWhere,select:{id:true,targetHost:true,programName:true,createdAt:true},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:historyBounds.skip,take:historyBounds.pageSize});
    return{bounds,targets,historyBounds,history};
  },{isolationLevel:'RepeatableRead'});
  const available=result.targets.filter(t=>{try{assertResearchTarget(t,userId);return true;}catch{return false;}}),history=result.history;
  return <div className="space-y-6"><h1 className="text-2xl font-semibold">Research</h1>
    <p className="text-sm text-muted">Review Recon, the plan and coverage, then continue Research manually in your local CLI with the Target handoff and scope.md.</p>
    <form action="/research" className="flex flex-wrap gap-3"><label>Search hosts<input name="q" defaultValue={input.q} maxLength={200} className="ml-2 rounded border border-border bg-surface p-2"/></label><input type="hidden" name="program" value={filter??''}/>{filter&&<input type="hidden" name="view" value="details"/>}<input type="hidden" name="pageSize" value={input.pageSize}/><button className="ui-btn" type="submit">Search</button></form>
    <CollectionPager path="/research" query={query.toString()} {...result.bounds} label="Research hosts pages" noun="owned host candidates"/>

    {!available.length && <p>No authorized hosts on this page. Configure an authorized asset in <Link href="/scopes" className="text-brand">Scope</Link>.</p>}
    <ul className="space-y-3">{available.map(t => <li key={t.id} className="flex flex-wrap items-center gap-4 border-b border-border py-5"><div className="mr-auto"><p>{t.program!.companyName}</p><h2 className="break-all font-medium">{t.host}</h2><p className="text-sm text-muted">Recon: {t.scanRuns[0]?.outcome?.toLowerCase()??t.scanRuns[0]?.status.toLowerCase()??'not run'}</p></div><ResearchCoverage targetId={t.id} compact/><ResearchPlan targetId={t.id} compact initialSummary={t.researchPlans[0]?{objectives:t.researchPlans[0].items.length,high:t.researchPlans[0].items.filter(item=>item.priority==='HIGH').length,reconCurrent:t.scanRuns[0]?.id===t.researchPlans[0].scanRunId&&t.scanRuns[0]?.status==='COMPLETED'}:undefined}/>{t.program&&<a className="text-sm text-brand" href={'/api/programs/'+t.program.id+'/scope.md'}>scope.md</a>}</li>)}</ul>
    {<details open={Boolean(search.historyPage)}><summary>Historical research sessions</summary><CollectionPager path="/research" query={query.toString()} {...result.historyBounds} pageKey="historyPage" label="Research history pages"/>{!history.length&&<p>No historical sessions match this view.</p>}<ul className="space-y-2 pt-3">{history.map(s => <li key={s.id}><Link className="text-brand" href={`/research/history/${s.id}`}>{s.programName} / {s.targetHost} · {s.createdAt.toISOString()}</Link></li>)}</ul></details>}
    <details><summary>Archived hunt runs</summary><Link href="/hunt" className="text-sm text-muted">View historical results</Link></details>
  </div>;
}
