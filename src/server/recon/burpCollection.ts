import { prisma } from '@/lib/prisma';
import { issueReconCollection,reconWorkerMac } from '@/lib/research/reconCollection';
import { readTerminalSigningKey } from '../research/terminalKey';
import { assetAllowsUrl } from '@/lib/scopeAssets';
import { isExcluded } from '@/lib/bountyProgram';
export async function collectRunBurp(runId:string,signal:AbortSignal):Promise<{status:string;observations:Record<string,string|number|boolean>[];version?:string}>{
  if(!process.env.AUTH_SECRET)return{status:'UNAVAILABLE',observations:[]};
  try{const time=String(Math.floor(Date.now()/1000)),mac=reconWorkerMac(runId,time,process.env.AUTH_SECRET);const r=await fetch(new URL('/api/internal/recon-observations',process.env.RECON_INTERNAL_WEB_URL??'http://web:3000'),{method:'POST',headers:{'content-type':'application/json','x-bughunter-run':runId,'x-bughunter-time':time,'x-bughunter-mac':mac},signal:AbortSignal.any([signal,AbortSignal.timeout(45000)]),redirect:'error'});if(!r.ok)return{status:'UNAVAILABLE',observations:[]};const text=await r.text();if(text.length>262144)return{status:'UNAVAILABLE',observations:[]};return JSON.parse(text);}catch{return{status:'UNAVAILABLE',observations:[]};}
}
export async function collectOwnedRunBurp(runId:string){
  const run=await prisma.scanRun.findUnique({where:{id:runId},include:{scopeAsset:{include:{program:true}}}}),asset=run?.scopeAsset;
  if(!run||run.status!=='RUNNING'||run.cancelRequestedAt||!asset?.active||asset.program.deletingAt)return{status:'UNAVAILABLE',observations:[]};
  const endpoints=await prisma.reconArtifact.findMany({where:{scanRunId:runId,kind:'endpoint',scopeState:'IN_SCOPE',verification:'OBSERVED'},select:{value:true},take:100,orderBy:{canonicalKey:'asc'}});
  const destinations=[...new Map(endpoints.flatMap(row=>{try{const url=String((row.value as {url?:string}).url),u=new URL(url);return assetAllowsUrl(asset,url)&&!isExcluded(u.hostname,asset.program.outOfScope)?[[u.origin,{hostname:u.hostname,scheme:u.protocol.slice(0,-1) as 'http'|'https',port:Number(u.port||(u.protocol==='https:'?443:80))}]]:[];}catch{return[];}})).values()].slice(0,8);
  if(!destinations.length)return{status:'SKIPPED',observations:[]};
  const token=issueReconCollection({scanRunId:runId,asset:{normalizedValue:asset.normalizedValue,format:asset.format,active:true},exclusions:asset.program.outOfScope,destinations},await readTerminalSigningKey());
  const response=await fetch(new URL('/control/recon-observations',process.env.RESEARCH_TERMINAL_CONTROL_URL??'http://research-console:7681'),{method:'POST',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(43000),redirect:'error'});
  if(!response.ok)return{status:'UNAVAILABLE',observations:[]};const text=await response.text();if(text.length>262144)throw new Error('Collection limit');return JSON.parse(text);
}
