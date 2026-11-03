import { join } from 'node:path';
import { assetAllowsUrl } from '@/lib/scopeAssets';
import { isSafeReadUrl } from '@/lib/observationSafety';
import type { ReconPlan } from '@/lib/reconPlanner';
import { gobusterCalibrationPolicy, type UnknownPathBaseline } from './calibration';
import { nucleiReconTemplates, NUCLEI_RECON_DENY } from './nucleiPolicy';
export function reconToolArguments(tool:string,args:string[],ctx:{reconPlan:ReconPlan;host:string;requiredUserAgent:string;reconTempDir?:string;ffufWordlist?:string;gobusterWordlist?:string;gobusterResolver?:string;reconRelayOrigin?:string;reconRelayTarget?:string;contentBaseline?:UnknownPathBaseline}) {
  const p=ctx.reconPlan,b=p.limits,ua=['-H',`User-Agent: ${ctx.requiredUserAgent}`];
  if(['subfinder','amass','assetfinder'].includes(tool)) {
    const seed=p.boundary.format==='WILDCARD_DOMAIN'?p.boundary.normalizedValue.slice(2):undefined;
    if(!seed||args.at(-1)!==seed||!p.stages.find(s=>s.name==='Passive discovery')?.enabled)throw new Error('Unauthorized passive seed');
    if(tool==='subfinder')return ['-d',seed,'-silent','-json','-cs','-duc','-timeout','10','-max-time',String(Math.max(1,Math.ceil(b.passiveSeconds/60))),'-rl',String(b.rps),...(p.depth==='DEEP'?['-all']:[])];
    if(tool==='assetfinder')return ['--subs-only',seed];
    if(!ctx.reconTempDir)throw new Error('Isolated Amass directory required');
    return ['enum','-passive','-nocolor','-d',seed,'-timeout',String(Math.max(1,Math.ceil(b.passiveSeconds/60))),'-dir',join(ctx.reconTempDir,'amass')];
  }
  if(p.activityMode!=='ACTIVE')throw new Error('Active Recon is not authorized');
  if(tool==='gobuster'&&args[0]==='dns') {
    if(!p.gobuster?.dns||p.format!=='WILDCARD_DOMAIN'||p.depth!=='DEEP'||!ctx.gobusterResolver||!/^127\.0\.0\.1:\d+$/.test(ctx.gobusterResolver)||!ctx.gobusterWordlist)throw new Error('Unauthorized DNS discovery');
    return ['dns','--domain',p.boundary.normalizedValue.slice(2),'--resolver',ctx.gobusterResolver,'--protocol','udp','--wordlist',ctx.gobusterWordlist,'--threads','1','--delay',`${Math.ceil(1000/b.rps)}ms`,'--timeout','3s','--quiet','--no-progress','--no-color'];
  }
  if(tool==='nmap') {
    if(!b.ports.length||p.format==='URL'||args.at(-1)!==ctx.host)throw new Error('Host-wide discovery is not authorized');
    return ['-sT','-Pn','-n','-p',b.ports.join(','),'--max-retries','0','--max-rate',String(Math.max(1,b.rps)),'--host-timeout','45s','-oX','-',ctx.host];
  }
  const url=args[args.indexOf('-u')+1];
  if(!url||!ctx.reconRelayOrigin||!ctx.reconRelayTarget)throw new Error('Guarded Recon relay required');
  const local=new URL(url.replace('FUZZ','probe')),origin=new URL(ctx.reconRelayOrigin);
  if(origin.hostname!=='127.0.0.1'||origin.protocol!=='http:'||local.origin!==origin.origin)throw new Error('Invalid Recon relay');
  const remote=new URL(local.pathname+local.search,new URL(ctx.reconRelayTarget).origin);
  if(remote.host!==ctx.host||!assetAllowsUrl(p.boundary,remote.toString())||!isSafeReadUrl(remote.toString()))throw new Error('URL outside Recon scope');
  if(tool==='httpx')return ['-u',url,'-silent','-json','-sc','-title','-ct','-location','-td','-tls-grab','-ob','-nfs','-duc','-threads','1','-rl',String(b.rps),'-timeout','8','-retries','0',...ua];
  if(tool==='gobuster') {
    if(args[0]!=='dir'||!p.gobuster?.dir||!ctx.gobusterWordlist||args[args.indexOf('-w')+1]!==ctx.gobusterWordlist)throw new Error('Unapproved Gobuster mode/profile');
    const calibration=ctx.contentBaseline?gobusterCalibrationPolicy(ctx.contentBaseline):undefined;
    if(calibration&&!calibration.enabled)throw new Error('NON_DISCRIMINATING_WILDCARD_RESPONSE: Gobuster skipped after target calibration');
    const filters=calibration?.excludeLengths?.length?['--exclude-length',calibration.excludeLengths.join(',')]:[];
    return ['dir','-u',url,'--wordlist',ctx.gobusterWordlist,'--threads','1','--delay',`${Math.ceil(1000/b.rps)}ms`,'--timeout','8s','--useragent',ctx.requiredUserAgent,'--expanded','--quiet','--no-progress','--no-color',...filters];
  }
  if(tool==='ffuf') {
    if(!ctx.ffufWordlist||args[args.indexOf('-w')+1]!==ctx.ffufWordlist||!url.endsWith('/FUZZ'))throw new Error('Unapproved ffuf profile');
    // Recursion is scheduled in the worker after scope validation of every
    // returned URL. Native redirect-driven recursion cannot enforce path scope.
    return ['-u',url,'-w',ctx.ffufWordlist,'-json','-s','-noninteractive','-ac','-sa','-sf','-se','-rate',String(b.rps),'-t','1','-timeout','8','-maxtime',String(b.ffufSeconds),'-maxtime-job',String(b.ffufSeconds),'-mc','all',...ua];
  }
  if(tool==='nuclei')return ['-u',url,'-t',nucleiReconTemplates(b.templates).join(','),'-silent','-jsonl','-omit-raw','-omit-template','-dr','-ni','-duc','-pt','http','-etags',NUCLEI_RECON_DENY.join(','),'-rl',String(b.rps),'-c','1','-bs','1','-timeout','8','-retries','0','-mhe','3','-rss','262144',...ua];
  throw new Error('Tool is not part of the approved Recon plan');
}
