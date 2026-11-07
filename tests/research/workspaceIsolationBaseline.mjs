// Secure acceptance gate: exits nonzero while the demonstrated vulnerability exists.
// Only disposable labelled volumes; consumer is the image-defined researcher, never root.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const exec=promisify(execFile),nonce=randomUUID(),prefix='bh-m8-isolation-'+nonce.slice(0,8),volume=prefix+'-workspaces';
const app='bughunter-m7-web:local',runner='bughunter-m7-research:local';
const run=async(args,options={})=>(await exec('docker',args,{timeout:120000,maxBuffer:2**20,...options})).stdout.trim();
const sha=text=>createHash('sha256').update(text).digest('hex');
const sourceFiles=['src/server/research/consoleWorkspace.ts','src/server/research/publicationFiles.ts','src/server/research/publicationLock.ts'];
const expected=Object.fromEntries(await Promise.all(sourceFiles.map(async path=>['/app/'+path,sha(await readFile(path))])));
const verify=`const fs=require('fs'),crypto=require('crypto'),expected=${JSON.stringify(expected)};for(const[p,h]of Object.entries(expected)){if(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==h)throw new Error('SOURCE_MISMATCH');}console.log('CANDIDATE_PUBLICATION_SOURCE_MATCH');`;
const validatorFiles=['docker/research/validator/console-files.mjs','docker/research/validator/burp-files.mjs','src/lib/research/consolePolicy.ts'];
const validatorExpected=Object.fromEntries(await Promise.all(validatorFiles.map(async path=>['/opt/bughunter/'+path,sha(await readFile(path))])));
const validatorVerify=`const fs=require('fs'),crypto=require('crypto'),expected=${JSON.stringify(validatorExpected)};for(const[p,h]of Object.entries(expected)){if(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==h)throw new Error('VALIDATOR_SOURCE_MISMATCH');}if(process.getuid()!==1000||process.getgid()!==1000)throw new Error('RUNTIME_IDENTITY_MISMATCH');console.log('CANDIDATE_VALIDATOR_SOURCE_MATCH');`;
const producer=`import{consoleBundle,writeConsoleWorkspace}from'/app/src/server/research/consoleWorkspace.ts';import{researchTarget}from'/app/tests/fixtures/research.ts';import{chmod,chown,lstat}from'node:fs/promises';
await chown('/workspaces',0,1000);await chmod('/workspaces',0o3770);
for(const suffix of ['alice','bob']){const target=researchTarget(),id='m8-'+suffix,owner='owner-'+suffix,host=suffix+'.example.test';Object.assign(target,{id,userId:owner,host,credentials:[]});Object.assign(target.scope,{id:'scope-'+suffix,userId:owner,hostPattern:host});Object.assign(target.program,{id:'program-'+suffix,ownerId:owner,scopeRules:[host],companyName:'Synthetic '+suffix});const files=consoleBundle(target,null,[],{id:'session-'+suffix,workspaceId:'research_'+id,createdAt:new Date('2026-11-07T00:00:00Z')});files['findings/notes.md']='M8_PRIVATE_'+suffix.toUpperCase();await writeConsoleWorkspace('/workspaces',id,files);}
console.log(JSON.stringify({published:2,owners:2,rootMode:((await lstat('/workspaces/research_m8-bob')).mode&0o7777).toString(8)}));`;
const consumer=`import fs from'node:fs';import{openConsoleWorkspace}from'/opt/bughunter/docker/research/validator/console-files.mjs';
const own=await openConsoleWorkspace();const result={uid:process.getuid(),gid:process.getgid(),capEff:/^CapEff:\\s*(.*)$/m.exec(fs.readFileSync('/proc/self/status','utf8'))?.[1],ownPolicyValidated:own.policy.targetId==='m8-alice',ownScopeReadable:false,foreignScopeReadable:false,foreignNotesReadable:false,foreignNotesWritable:false,foreignPolicyValidated:false,foreignScopeWritable:false};await own.root.close();
result.ownScopeReadable=fs.readFileSync('scope.md','utf8').includes('alice.example.test');
try{result.foreignScopeReadable=fs.readFileSync('/workspaces/research_m8-bob/scope.md','utf8').includes('bob.example.test');}catch{}
try{result.foreignNotesReadable=fs.readFileSync('/workspaces/research_m8-bob/findings/notes.md','utf8')==='M8_PRIVATE_BOB';}catch{}
try{fs.appendFileSync('/workspaces/research_m8-bob/findings/notes.md','\\nM8_FOREIGN_WRITE');result.foreignNotesWritable=true;}catch{}
try{const other=await openConsoleWorkspace('/workspaces/research_m8-bob');result.foreignPolicyValidated=other.policy.targetId==='m8-bob';await other.root.close();}catch{}
try{const fd=fs.openSync('/workspaces/research_m8-bob/scope.md','r+');fs.closeSync(fd);result.foreignScopeWritable=true;}catch{}
result.status=result.foreignScopeReadable||result.foreignNotesReadable||result.foreignNotesWritable||result.foreignPolicyValidated?'FAIL_ISOLATION':'PASS';console.log(JSON.stringify(result));`;
let created=false;
try{
 console.log(await run(['run','--rm','--network','none','--entrypoint','node',app,'-e',verify]));
 console.log(await run(['run','--rm','--network','none','--user','researcher','--cap-drop','ALL','--entrypoint','node',runner,'-e',validatorVerify]));
 await run(['volume','create','--label','bughunter.m8-isolation='+nonce,volume]);created=true;
 console.log(await run(['run','--rm','--name',prefix+'-producer','--label','bughunter.m8-isolation='+nonce,'--network','none','--mount','type=volume,source='+volume+',target=/workspaces','-e','RESEARCH_WORKSPACE_UID=1000','-e','RESEARCH_WORKSPACE_GID=1000','--entrypoint','node',app,'--import','tsx','--input-type=module','-e',producer]));
 const output=await run(['run','--rm','--name',prefix+'-consumer','--label','bughunter.m8-isolation='+nonce,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--user','researcher','--workdir','/workspaces/research_m8-alice','--mount','type=volume,source='+volume+',target=/workspaces','--entrypoint','node',runner,'--input-type=module','-e',consumer]);
 const result=JSON.parse(output);if(result.uid!==1000||result.gid!==1000||result.capEff!=='0000000000000000'||!result.ownPolicyValidated||!result.ownScopeReadable)throw new Error('INVALID_RUNTIME_OR_OWN_CONTEXT');console.log(JSON.stringify(result));await writeFile(process.env.ISOLATION_RESULT_FILE ?? '/tmp/bughunter-workspace-isolation-result.json',JSON.stringify({candidate:'9b3aa25080b0bcdb47137d448444fb890e64b5fb',sourceMatch:true,producerOwners:2,...result},null,2));if(result.status!=='PASS')process.exitCode=1;
}finally{
 for(const suffix of ['producer','consumer']){const name=prefix+'-'+suffix;const owner=await run(['inspect','--format','{{index .Config.Labels "bughunter.m8-isolation"}}',name]).catch(()=>null);if(owner===nonce)await run(['rm','-f',name]);}
 if(created){const owner=await run(['volume','inspect','--format','{{index .Labels "bughunter.m8-isolation"}}',volume]);if(owner!==nonce)throw new Error('REFUSE_FOREIGN_VOLUME');await run(['volume','rm',volume]);console.log('OWNED_FIXTURE_CLEANUP_PASS');}
}

