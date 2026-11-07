// Actual broker -> dedicated UID -> tmux -> native provider acceptance.
// Disposable labelled containers/volume only. Empty private auth homes prevent inference.
// Native CLIs may perform vendor connectivity/login checks; no target commands run.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {issueStopTicket,issueTerminalTicket} from '../../src/lib/research/terminal';
const execute=promisify(execFile),nonce=randomUUID(),name='bh42-'+nonce.slice(0,8),volume=name+'-workspace',image='bughunter-issue42-research:local';
const temporary=await mkdtemp(join(tmpdir(),name));
await chmod(temporary,0o755);
const run=async(args:string[],input?:string)=>(await execute('docker',args,{input,timeout:30000,maxBuffer:1024*1024} as never)).stdout.trim();
// execFile does not take stdin input; use file redirection inside container only
// with fixed argument paths, never interpolated tokens or researcher content.
const exec=async(args:string[])=>run(['exec',name,...args]);
const keys=generateKeyPairSync('ed25519'),privateKey=keys.privateKey.export({type:'pkcs8',format:'pem'}).toString();
await writeFile(join(temporary,'public.pem'),keys.publicKey.export({type:'spki',format:'pem'}));
const label='bughunter.issue42='+nonce;
let created=false,started=false;
try {
 await run(['volume','create','--label',label,volume]);created=true;
 const baseline=await readFile('tests/research/workspaceIsolationBaseline.mjs','utf8');
 const producer=baseline.split('const producer=`')[1].split('`;\nconst consumer=')[0].replace("['alice','bob']","['alice','bob','charlie']").replace('published:2,owners:2','published:3,owners:3').replace("await writeConsoleWorkspace('/workspaces',id,files);","files['recon/hosts.json']='{}';files['research/plan.md']='Fixture plan';files['research/coverage.md']='Fixture coverage';await writeConsoleWorkspace('/workspaces',id,files);");
 console.log(await run(['run','--rm','--network','none','--mount',`type=volume,source=${volume},target=/workspaces`,'-e','RESEARCH_WORKSPACE_UID=1000','-e','RESEARCH_WORKSPACE_GID=1000','--entrypoint','node','bughunter-m7-web:local','--import','tsx','--input-type=module','-e',producer]));
 await run(['run','-d','--init','--name',name,'--label',label,'--network','bridge','--cap-drop','ALL',...['CHOWN','FOWNER','DAC_OVERRIDE','SETUID','SETGID','SETPCAP','KILL'].flatMap(cap=>['--cap-add',cap]),'--mount',`type=volume,source=${volume},target=/workspaces`,'--mount',`type=bind,source=${temporary},target=/fixtures,readonly`,'--mount',`type=bind,source=${temporary}/public.pem,target=/run/research-terminal/public.pem,readonly`,'--entrypoint','python3',image,'/opt/bughunter/docker/research/broker/broker.py']);started=true;
 for(let n=0;n<30;n++){try{await exec(['test','-S','/run/bughunter-broker/control.sock']);break;}catch{await new Promise(resolve=>setTimeout(resolve,100));if(n===29)throw new Error('BROKER_START_FAILED');}}
 const ids:Record<string,number>={};
 await writeFile(join(temporary,'validator.mjs'),await readFile('tests/research/runtimeValidatorProbe.mjs'));
 for(const suffix of ['alice','bob']) {
   const hash=(await exec(['sha256sum',`/workspaces/research_m8-${suffix}/.agents/bughunter/policy.json`])).split(' ')[0];
  const ticket=issueTerminalTicket({userId:'owner-'+suffix,targetId:'m8-'+suffix,sessionId:'session-'+suffix,policySha256:hash},privateKey).token;
  await writeFile(join(temporary,suffix+'.ticket'),ticket,{mode:0o600});
  if(suffix==='alice'){await writeFile(join(temporary,'export.py'),await readFile('tests/research/providerExportFixture.py'));await exec(['python3','/fixtures/export.py']);}
  const migrate=()=>exec(['sh','-c',`python3 -c 'import sys;sys.path.insert(0,"/opt/bughunter/docker/research/broker");from migrate import migrate;print(migrate(sys.stdin.read(),True))'  < /fixtures/${suffix}.ticket`]);
  console.log(await migrate());console.log(await migrate());
 }
 const ledger=JSON.parse(await exec(['cat','/var/lib/bughunter-identities/ledger.json']));
 for(const suffix of ['alice','bob'])ids[suffix]=ledger.targets['m8-'+suffix].uid;
 const cHash=(await exec(['sha256sum','/workspaces/research_m8-charlie/.agents/bughunter/policy.json'])).split(' ')[0];
 const cTicket=issueTerminalTicket({userId:'owner-charlie',targetId:'m8-charlie',sessionId:'session-charlie',policySha256:cHash},privateKey).token;
 await exec(['node','-e',"const fs=require('fs');fs.writeFileSync('/workspaces/research_m8-charlie/.agents/bughunter/isolation-new.json',JSON.stringify({version:1,targetId:'m8-charlie',workspaceId:'research_m8-charlie',sessionId:'session-charlie'}),{mode:0o440})"]);
 await writeFile(join(temporary,'fresh.json'),JSON.stringify({operation:'admit',token:cTicket}),{mode:0o600});
 await Promise.all([1,2].map(()=>exec(['setpriv','--reuid=1000','--regid=1000','--clear-groups','sh','-c','python3 /opt/bughunter/docker/research/broker/client.py --request-stdin < /fixtures/fresh.json'])));
 const allocated=JSON.parse(await exec(['cat','/var/lib/bughunter-identities/ledger.json']));assert.equal(allocated.targets['m8-charlie'].uid,200003);
 console.log('FRESH_SERVER_BOUND_ALLOCATION_PASS');
 assert.notEqual(ids.alice,ids.bob);
 assert((await exec(['cat','/var/lib/bughunter-homes/'+ids.alice+'/.codex/sessions/2026/11/07/fixture.jsonl'])).includes('PRIVATE_A_TRANSCRIPT'));
 console.log('REVIEWED_TRANSCRIPT_EXPORT_PRESERVED_PASS');
 for(const [suffix,provider,profile] of [['alice','codex','yolo'],['bob','claude','standard']] as const) {
  const request={operation:'start',targetId:'m8-'+suffix,provider,profile};
  console.log(await exec(['setpriv','--reuid=1000','--regid=1000','--clear-groups','python3','/opt/bughunter/docker/research/broker/client.py',JSON.stringify(request)]));
 }
 await new Promise(resolve=>setTimeout(resolve,1500));
 const processes=await exec(['ps','-eo','uid,gid,args']);
 const all=await exec(['ps','-eo','pid,uid,args']);
 const bPid=Number(all.split('\n').find(line=>line.trim().split(/\s+/)[1]===String(ids.bob)&&line.includes('tmux'))!.trim().split(/\s+/)[0]);
 await writeFile(join(temporary,'probe.mjs'),await readFile('tests/research/runtimeIsolationProbe.mjs'));
 await writeFile(join(temporary,'codex-probe.mjs'),await readFile('tests/research/codexKernelProbe.mjs'));
 await exec(['setpriv','--reuid='+ids.alice,'--regid='+ids.alice,'--clear-groups','tmux','-S','/var/lib/bughunter-homes/'+ids.alice+'/run/tmux.sock','new-window','-d','-t','=bughunter_codex_m8-alice:','-c','/workspaces/research_m8-alice','node','/fixtures/codex-probe.mjs',String(ids.alice),String(ids.bob),String(bPid)]);
 let result;for(let n=0;n<200;n++){try{result=JSON.parse(await exec(['cat','/workspaces/research_m8-alice/findings/isolation-result.json']));break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
 console.log(JSON.stringify(result));assert.equal(result?.status,'KERNEL_RUNTIME_PASS');
 console.log(processes.split('\n').filter(line=>(line.includes(String(ids.alice))||line.includes(String(ids.bob)))&&!line.includes('bootstrap')&&!line.includes('Research target:')).join('\n'));
 console.log(await exec(['setpriv','--reuid='+ids.bob,'--regid='+ids.bob,'--clear-groups','tmux','-S','/var/lib/bughunter-homes/'+ids.bob+'/run/tmux.sock','capture-pane','-p','-t','=bughunter_claude_m8-bob:']));
 // Assert native processes survived startup in the dedicated tmux sessions.
 assert(processes.split('\n').some(line=>line.trim().startsWith(String(ids.alice))&&line.includes('/usr/local/bin/codex')),'Native Codex missing');
 assert(processes.split('\n').some(line=>line.trim().startsWith(String(ids.bob))&&line.trim().split(/\s+/)[2]==='claude'),'Native Claude missing or offline startup failed');
 // A second provider shares only A's isolated home/socket/identity.
 await exec(['setpriv','--reuid=1000','--regid=1000','--clear-groups','python3','/opt/bughunter/docker/research/broker/client.py',JSON.stringify({operation:'start',targetId:'m8-alice',provider:'claude',profile:'standard'})]);
 for(const [own,foreign] of [['alice','bob'],['bob','alice']]) {
  const output=await exec(['setpriv','--reuid='+ids[own],'--regid='+ids[own],'--clear-groups','--no-new-privs','node','/fixtures/validator.mjs','/workspaces/research_m8-'+own,'/workspaces/research_m8-'+foreign]);assert.equal(output,'OWN_PASS_FOREIGN_DENIED');
 }
 await exec(['rm','/workspaces/research_m8-alice/findings/isolation-result.json']);
 await exec(['setpriv','--reuid='+ids.alice,'--regid='+ids.alice,'--clear-groups','tmux','-S','/var/lib/bughunter-homes/'+ids.alice+'/run/tmux.sock','new-window','-d','-t','=bughunter_claude_m8-alice:','-c','/workspaces/research_m8-alice','node','/fixtures/probe.mjs',String(ids.alice),String(ids.bob),String(bPid)]);
 let claudeResult;for(let n=0;n<50;n++){try{claudeResult=JSON.parse(await exec(['cat','/workspaces/research_m8-alice/findings/isolation-result.json']));break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}assert.equal(claudeResult?.status,'KERNEL_RUNTIME_PASS');
 console.log('CLAUDE_A_TMUX_CHILD_KERNEL_MATRIX_PASS');
 for(const [field,value] of [['policySha256','f'.repeat(64)],['state','revoked'],['workspaceId','research_m8-bob'],['sessionId','session-bob']] as const) {
  const path='/var/lib/bughunter-identities/active/'+ids.alice+'.json';
  const original=await exec(['cat',path]);
  await exec(['node','-e','const fs=require("fs"),p=process.argv[1],v=JSON.parse(fs.readFileSync(p));v[process.argv[2]]=process.argv[3];fs.writeFileSync(p,JSON.stringify(v))',path,field,value]);
  await assert.rejects(()=>exec(['setpriv','--reuid='+ids.alice,'--regid='+ids.alice,'--clear-groups','--no-new-privs','node','/fixtures/validator.mjs','/workspaces/research_m8-alice','/workspaces/research_m8-bob']));
  await exec(['node','-e','require("fs").writeFileSync(process.argv[1],process.argv[2])',path,original]);
 }
 console.log('VALIDATOR_STALE_REVOKED_FORGED_SESSION_PASS');
 console.log('VALIDATOR_AB_BA_PASS');
 console.log('BROKER_NATIVE_START_PASS');
 const mcp=new Client({name:'issue42-fixture',version:'1'},{capabilities:{}});
 const transport=new StdioClientTransport({command:'docker',args:['exec','-i','--workdir','/workspaces/research_m8-alice',name,'setpriv','--reuid='+ids.alice,'--regid='+ids.alice,'--clear-groups','--no-new-privs','node','/opt/bughunter/docker/research/validator/console-burp-main.mjs','stdio'],stderr:'pipe'});
 try {
  await mcp.connect(transport);const tools=await mcp.listTools();assert(tools.tools.some(tool=>tool.name==='burp_history'));
  const denied=await mcp.callTool({name:'burp_history',arguments:{host:'bob.example.test'}});
  assert.equal(denied.isError,true);assert(JSON.stringify(denied).includes('OUT_OF_SCOPE'));
  console.log('MCP_INITIALIZATION_AND_FOREIGN_SCOPE_DENIAL_PASS');
 } finally {await mcp.close();}
 await run(['restart',name]);
 for(let n=0;n<50;n++){try{await exec(['test','-S','/run/bughunter-broker/control.sock']);break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
 const after=JSON.parse(await exec(['cat','/var/lib/bughunter-identities/ledger.json']));assert.equal(after.targets['m8-alice'].uid,ids.alice);assert.equal(after.targets['m8-bob'].uid,ids.bob);
 assert((await exec(['cat','/workspaces/research_m8-alice/findings/notes.md'])).includes('ISOLATED_NOTE'));
 console.log('RESTART_IDENTITY_AND_NOTES_PASS');
 for(const [suffix,provider,profile] of [['alice','codex','yolo'],['bob','claude','standard']] as const)await exec(['setpriv','--reuid=1000','--regid=1000','--clear-groups','python3','/opt/bughunter/docker/research/broker/client.py',JSON.stringify({operation:'start',targetId:'m8-'+suffix,provider,profile})]);
 const stop=issueStopTicket('m8-alice','research_m8-alice',privateKey);
 await writeFile(join(temporary,'revoke.json'),JSON.stringify({operation:'revoke',token:stop}),{mode:0o600});
 await exec(['setpriv','--reuid=1000','--regid=1000','--clear-groups','sh','-c','python3 /opt/bughunter/docker/research/broker/client.py --request-stdin < /fixtures/revoke.json']);
 await assert.rejects(()=>exec(['setpriv','--reuid=1000','--regid=1000','--clear-groups','python3','/opt/bughunter/docker/research/broker/client.py',JSON.stringify({operation:'start',targetId:'m8-alice',provider:'codex',profile:'yolo'})]));
 await exec(['setpriv','--reuid=1000','--regid=1000','--clear-groups','python3','/opt/bughunter/docker/research/broker/client.py',JSON.stringify({operation:'exists',targetId:'m8-bob',provider:'claude',profile:'standard'})]);
 const remaining=await exec(['ps','-eo','uid,stat,args']);assert(!remaining.split('\n').some(line=>line.trim().split(/\s+/)[0]===String(ids.alice)&&!line.trim().split(/\s+/)[1].startsWith('Z')));
 console.log('REVOCATION_KILLS_ONLY_A_AND_PREVENTS_RESTART_PASS');
 await writeFile(join(temporary,'delete.json'),JSON.stringify({operation:'delete',token:issueStopTicket('m8-alice','research_m8-alice',privateKey)}),{mode:0o600});
 for(let n=0;n<2;n++)await exec(['setpriv','--reuid=1000','--regid=1000','--clear-groups','sh','-c','python3 /opt/bughunter/docker/research/broker/client.py --request-stdin < /fixtures/delete.json']);
 await assert.rejects(()=>exec(['test','-e','/var/lib/bughunter-homes/'+ids.alice]));
 await exec(['setpriv','--reuid=1000','--regid=1000','--clear-groups','python3','/opt/bughunter/docker/research/broker/client.py',JSON.stringify({operation:'exists',targetId:'m8-bob',provider:'claude',profile:'standard'})]);
 const retired=JSON.parse(await exec(['cat','/var/lib/bughunter-identities/ledger.json']));assert.equal(retired.targets['m8-alice'].state,'deleted');assert.equal(retired.next,200004);
 console.log('IDEMPOTENT_PRIVATE_HOME_DELETION_AND_UID_TOMBSTONE_PASS');
} finally {
 if(started){assert.equal(await run(['inspect','--format','{{index .Config.Labels "bughunter.issue42"}}',name]),nonce);await run(['rm','-f',name]);}
 if(created){assert.equal(await run(['volume','inspect','--format','{{index .Labels "bughunter.issue42"}}',volume]),nonce);await run(['volume','rm',volume]);}
 await rm(temporary,{recursive:true,force:true});
}
