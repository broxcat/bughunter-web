import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { loadTargetCampaign } from '@/server/targetCampaign';
import { CampaignState } from '@/components/TargetCampaignView';
import ResearchConsoleManager from '@/components/ResearchConsoleManager';
import { assertResearchTarget, researchTargetSelect } from '@/server/research/workspace';
import { ownedResearch } from '@/server/research/sessions';

export default async function ResearchPage({searchParams}:{searchParams:Promise<{program?:string;view?:string}>}) {
  const search=await searchParams;
  const filter=search.program;
  const session=await auth();
  if(!session?.user?.id)return null;
  const userId=session.user.id;

  if(filter&&search.view==='campaign'){
    const campaign=await loadTargetCampaign(userId,filter);
    if(!campaign)notFound();
    const stage=campaign.view.stages[2];
    return <div className="max-w-3xl space-y-5">
      <Link href={'/targets/'+filter} className="text-sm text-brand">← {campaign.program.companyName}</Link>
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold">Research</h1><CampaignState state={stage.state}/></div>
      {stage.detail&&<p className="text-sm text-muted">{stage.detail}</p>}
      <p>Select the hosts you want to investigate. No research console is created automatically.</p>
      <Link className="text-brand underline" href={'/research?program='+filter+'&view=details'} prefetch={false}>Choose hosts</Link>
    </div>;
  }

  const result=await prisma.$transaction(async tx=>{
    const where={userId,...(filter?{programId:filter}:{}),OR:[{active:true},{scopeAsset:{active:true}}],program:{ownerId:userId}};
    const targets=await tx.target.findMany({
      where,
      take:500,
      select:{
        ...researchTargetSelect,
        researchSessions:{where:{consoleTargetId:{not:null}},select:{id:true,status:true},orderBy:[{createdAt:'desc'},{id:'desc'}],take:1},
        scanRuns:{where:{type:'RECON'},orderBy:[{createdAt:'desc'},{id:'desc'}],take:1,select:{status:true,outcome:true}},
      },
      orderBy:[{host:'asc'},{id:'asc'}],
    });
    const history=await tx.researchSession.findMany({
      where:{...ownedResearch(userId),consoleTargetId:null,...(filter?{target:{...ownedResearch(userId).target,programId:filter}}:{})},
      select:{id:true,targetHost:true,programName:true,createdAt:true},
      orderBy:[{createdAt:'desc'},{id:'desc'}],
      take:25,
    });
    return{targets,history};
  },{isolationLevel:'RepeatableRead'});

  const candidates=result.targets.flatMap(target=>{
    try{assertResearchTarget(target,userId);}catch{return[];}
    const latest=target.scanRuns[0];
    return [{
      id:target.id,
      host:target.host,
      programName:target.program!.companyName,
      recon:latest?.outcome?.toLowerCase()??latest?.status.toLowerCase()??'not run',
      existingSessionId:target.researchSessions[0]?.id,
      deleting:Boolean(target.consoleDeletingAt),
    }];
  });

  return <div className="max-w-4xl space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">Research</h1><p className="mt-1 text-sm text-muted">Create consoles only for the hosts you choose to investigate.</p></div>
      {filter&&<Link className="text-sm text-brand" href={'/targets/'+filter}>← Target</Link>}
    </div>

    <ResearchConsoleManager candidates={candidates}/>

    {result.history.length>0&&<details className="ui-disclosure"><summary>Historical research sessions</summary>
      <ul className="mt-3 space-y-2">{result.history.map(item=><li key={item.id}>
        <Link className="text-brand" href={'/research/history/'+item.id}>{item.programName} / {item.targetHost} · {item.createdAt.toISOString()}</Link>
      </li>)}</ul>
    </details>}
  </div>;
}
