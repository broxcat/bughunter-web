import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function auditResearchEvidenceNavigation({prisma,owner,origin,context,page}){
 const program=await prisma.bountyProgram.create({data:{ownerId:owner.id,companyName:'Hypothesis paging fixture',requiredUserAgent:'Fixture/1'}}),scope=await prisma.scope.create({data:{userId:owner.id,hostPattern:'registry.fixture.test',status:'APPROVED'}}),target=await prisma.target.create({data:{userId:owner.id,programId:program.id,scopeId:scope.id,host:'registry.fixture.test'}});
 const session=await prisma.researchSession.create({data:{userId:owner.id,targetId:target.id,workspaceId:randomUUID(),status:'ARCHIVED',targetHost:target.host,programName:program.companyName,scopeMarkdown:'# Historical fixture'}});
 const hypotheses=Array.from({length:51},(_,n)=>({id:session.id+'_hyp_'+String(n).padStart(3,'0'),sessionId:session.id,externalId:'H-'+String(n+1).padStart(3,'0'),title:'Registry fixture '+n,status:'OPEN',hypothesis:'Unknown',evidenceFor:[],evidenceAgainst:[],nextTest:'Manual review',expectedSignal:'Unknown',falsificationCondition:'Unknown',contentSha256:'a'.repeat(64),revision:n===0?26:1}));
 await prisma.researchHypothesis.createMany({data:hypotheses});await prisma.researchHypothesisRevision.createMany({data:Array.from({length:26},(_,n)=>({hypothesisId:hypotheses[0].id,revision:n+1,snapshot:{status:'OPEN'}}))});
 const evidence=Array.from({length:101},(_,n)=>({id:session.id+'_ev_'+String(n).padStart(3,'0'),targetId:target.id,kind:'RESEARCH_EVIDENCE',sourceKey:String(n),description:'Synthetic bounded evidence',provenance:{},redactionStatus:'METADATA_ONLY',metadata:{},createdAt:new Date('2026-01-01')}));
 await prisma.evidenceRecord.createMany({data:evidence});await prisma.evidenceHypothesis.createMany({data:evidence.map(e=>({evidenceId:e.id,hypothesisId:hypotheses[0].id,hypothesisReferenceId:hypotheses[0].id,revision:1,role:'CONTEXT'}))});
 const path='/research/history/'+session.id,detail=path+'/hypotheses/'+hypotheses[0].id;let checks=0;
 for(const theme of ['light','dark'])for(const width of [1280,390]){
  await page.setViewportSize({width,height:900});await page.evaluate(t=>localStorage.setItem('theme',t),theme);
  await page.goto(origin+path);const region=page.getByRole('region',{name:'Hypotheses',exact:true});
  for(const n of [2,3]){await region.getByRole('button',{name:'Next',exact:true}).click();await region.getByText(`Page ${n} / 3`,{exact:true}).waitFor();}
  await page.reload();await region.getByText('Page 3 / 3',{exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('hypothesisPage'),'3');
  await region.getByRole('button',{name:'Previous',exact:true}).click();await region.getByText('Page 2 / 3',{exact:true}).waitFor();await page.goBack();await region.getByText('Page 3 / 3',{exact:true}).waitFor();await page.goForward();await region.getByText('Page 2 / 3',{exact:true}).waitFor();
  await region.getByRole('button',{name:'Rejected',exact:true}).click();await region.getByText(/No hypotheses in this view/).waitFor();assert.equal(new URL(page.url()).searchParams.get('status'),'REJECTED');assert.equal(new URL(page.url()).searchParams.get('hypothesisPage'),'1');
  await page.reload();await region.getByText(/No hypotheses in this view/).waitFor();await region.getByRole('button',{name:'All',exact:true}).click();await region.getByText('Page 1 / 3',{exact:true}).waitFor();
  await page.goto(origin+path+'?hypothesisPage=999');await region.getByText('Page 3 / 3',{exact:true}).waitFor();
  await prisma.researchHypothesis.delete({where:{id:hypotheses[50].id}});await page.reload();await region.getByText('Page 2 / 2',{exact:true}).waitFor();await prisma.researchHypothesis.create({data:hypotheses[50]});
  await page.goto(origin+detail+'?revisionPage=99');await page.getByText(/^Revision 1 ·/).waitFor();await page.getByRole('link',{name:'Newer revisions',exact:true}).click();await page.getByText(/^Revision 26 — current/).waitFor();await page.goBack();await page.getByText(/^Revision 1 ·/).waitFor();
  const panel=page.locator(`details[aria-label="Evidence for hypothesis ${hypotheses[0].id}"]`),nav=panel.getByRole('navigation',{name:'Evidence pages'});
  await panel.locator(':scope > summary').click();await nav.getByRole('status').filter({hasText:'Evidence page 1 · 100 records'}).waitFor();
  await nav.getByRole('button',{name:'Older evidence',exact:true}).click();await nav.getByRole('status').filter({hasText:'Evidence page 2 · 1 records'}).waitFor();assert.equal(await panel.locator('article').count(),1);
  await nav.getByRole('button',{name:'Newer evidence',exact:true}).click();await nav.getByRole('status').filter({hasText:'Evidence page 1 · 100 records'}).waitFor();
  const pattern=origin+'/api/evidence/'+target.id+'*';let remove=true;
  const intercept=async route=>{if(remove&&new URL(route.request().url()).searchParams.has('before')){remove=false;await prisma.evidenceRecord.delete({where:{id:evidence[0].id}});}return route.continue();};
  await context.route(pattern,intercept);
  try{await nav.getByRole('button',{name:'Older evidence',exact:true}).click();await panel.getByRole('status').filter({hasText:'Evidence changed; showing newest retained records.'}).waitFor();await nav.getByRole('status').filter({hasText:'Evidence page 1 · 100 records'}).waitFor();assert.equal(await panel.locator('article').count(),100);}finally{await context.unroute(pattern,intercept);}
  await prisma.evidenceRecord.create({data:evidence[0]});await prisma.evidenceHypothesis.create({data:{evidenceId:evidence[0].id,hypothesisId:hypotheses[0].id,hypothesisReferenceId:hypotheses[0].id,revision:1,role:'CONTEXT'}});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);checks++;
 }
 console.log(`RESEARCH_EVIDENCE_BROWSER: ${checks} passed, 0 failed, 0 skipped`);
}
