# Research workspace isolation — failed v1.1 acceptance

> **Retired.** The Research console (Codex/Claude terminals, Burp bridge and their containers) has been removed from BugHunter. Research is now done manually in a local CLI. This page is kept for history only; see [Research console removal](research-console-removal.md).

## Decision

**BLOCKER — [#42](https://github.com/broxcat/bughunter-web/issues/42).** Milestone 8 stopped before production mutation or release preparation. Candidate: `041f47989c35a2b2c5a9671f4e6bc27f5b3882f5`; runtime/test parent: `dea516083bb3c50bb35553857ec37679819c4e38`.

The required property is that a native process in one admitted host workspace cannot read/write another owner's host workspace or adopt its context. HTTP owner checks, signed browser tickets, separate tmux names and immutable scope hashes are separate controls; their previous acceptance does not demonstrate this filesystem boundary.

## Fixture and result

The real `consoleBundle` / `writeConsoleWorkspace` helpers generated and durably activated two complete workspaces for different synthetic owner/program/host identities. All three publication/helper source hashes in the application fixture matched this checkout. This is an exact-helper filesystem acceptance, not a claim that two real accounts logged in or that HTTP admission was bypassed.

- Application fixture: `sha256:a7dd59c013fc10269c003fc0d19547f29e7450b8becdb7c575ac86df34fce396`.
- Research runner: `sha256:84cb85b08312c636bc60021286f3ee81ccd34e86384f45fb7e2675ccfa902594`.
- Only a newly created UUID-labelled fixture volume was mounted. No production workspace, CLI home, DB, signing key or credential was mounted/read.
- Consumer CWD was host A. Actual `researcher` UID/GID: `1000/1000`; effective capabilities: zero. Container network disabled, root filesystem read-only, all capabilities dropped, no-new-privileges enabled.
- Host A's own policy and scope validated normally. Host B's scope and synthetic private notes were readable; B's notes could be appended; the real workspace validator also accepted B's directory from A's process.
- B's immutable scope file refused a write, showing that read-only authorization-file protection works but does not isolate context or mutable evidence.
- Required gate: **1 failed**, with **4 foreign-boundary assertions violated**. Script exit **1**. Own-context and immutable-scope controls passed. Owned fixture cleanup passed, with no remaining fixture volume/container.

```json
{
  "candidate": "041f47989c35a2b2c5a9671f4e6bc27f5b3882f5",
  "sourceMatch": true,
  "producerOwners": 2,
  "uid": 1000,
  "gid": 1000,
  "capEff": "0000000000000000",
  "ownPolicyValidated": true,
  "ownScopeReadable": true,
  "foreignScopeReadable": true,
  "foreignNotesReadable": true,
  "foreignNotesWritable": true,
  "foreignPolicyValidated": true,
  "foreignScopeWritable": false,
  "status": "FAIL_ISOLATION"
}
```

No public target request, paid inference, production exploit, network Scope bypass or credential access was attempted or inferred. The demonstrated boundary is cross-owner filesystem confidentiality/integrity in the common Research runtime, including context validation. It is directly relevant to Codex YOLO's unsandboxed native tools; model instructions are not an authorization boundary.

## Cause and correction requirements

`publicationFiles.ts` activates READY roots with mode `2750`; immutable context uses shared group-readable files (`440`), while writable findings/evidence use the common Research UID/GID (`660` files, `2770` directories). The native console service uses that same Research identity and shared `/workspaces` mount for every host. `openConsoleWorkspace` checks directory structure/identity/integrity, not an authenticated caller's filesystem principal. Distinct names, CWD or a matching policy hash cannot deny access to another complete valid workspace.

A correction requires an enforced per-console filesystem/principal boundary, with regression coverage for two owners and hosts. Preserve immutable authorization snapshots, trusted DB Scope checks, auth/history volumes, reconnect and persistent console semantics. Do not address this solely through UI filtering, instructions, policy-hash checks or by making current authorized context unreadable to every console. No architectural patch or workspace migration was attempted after the failed release gate.

## Reproduction

From the frozen clean candidate checkout, with the two recorded local disposable fixture images available, save the following as `/tmp/bh-m8/workspace-isolation.mjs` and run:

```sh
mkdir -p /tmp/bh-m8
node /tmp/bh-m8/workspace-isolation.mjs
```

Expected secure result is `PASS` with all four foreign-access booleans false. The candidate instead emits `FAIL_ISOLATION`, exits1 and cleans only its own nonce-labelled resources. No production infrastructure is used. Images must match the candidate helper hashes; otherwise the recipe refuses to make a product claim. These are existing test artifacts with verified source, not an exact-candidate production Docker build acceptance.

```javascript
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
 await run(['volume','create','--label','bughunter.m8-isolation='+nonce,volume]);created=true;
 console.log(await run(['run','--rm','--name',prefix+'-producer','--label','bughunter.m8-isolation='+nonce,'--network','none','--mount','type=volume,source='+volume+',target=/workspaces','-e','RESEARCH_WORKSPACE_UID=1000','-e','RESEARCH_WORKSPACE_GID=1000','--entrypoint','node',app,'--import','tsx','--input-type=module','-e',producer]));
 const output=await run(['run','--rm','--name',prefix+'-consumer','--label','bughunter.m8-isolation='+nonce,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--user','researcher','--workdir','/workspaces/research_m8-alice','--mount','type=volume,source='+volume+',target=/workspaces','--entrypoint','node',runner,'--input-type=module','-e',consumer]);
 const result=JSON.parse(output);console.log(JSON.stringify(result));await writeFile('/tmp/bh-m8/workspace-isolation-result.json',JSON.stringify({candidate:'041f47989c35a2b2c5a9671f4e6bc27f5b3882f5',sourceMatch:true,producerOwners:2,...result},null,2));if(result.status!=='PASS')process.exitCode=1;
}finally{
 for(const suffix of ['producer','consumer']){const name=prefix+'-'+suffix;const owner=await run(['inspect','--format','{{index .Config.Labels "bughunter.m8-isolation"}}',name]).catch(()=>null);if(owner===nonce)await run(['rm','-f',name]);}
 if(created){const owner=await run(['volume','inspect','--format','{{index .Labels "bughunter.m8-isolation"}}',volume]);if(owner!==nonce)throw new Error('REFUSE_FOREIGN_VOLUME');await run(['volume','rm',volume]);console.log('OWNED_FIXTURE_CLEANUP_PASS');}
}

```
