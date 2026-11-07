// Kernel/registry primitive test only. This does not exercise console admission,
// provider launchers, migration or lifecycle and is not Issue 42 acceptance.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const exec = promisify(execFile);
const modulePath = resolve('docker/research/validator/runtime-binding.mjs');
const fixture = String.raw`
import {mkdir,writeFile,chown,chmod} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
for (const dir of ['/var/lib/bughunter-identities','/var/lib/bughunter-identities/active','/private-homes']) await mkdir(dir,{recursive:true,mode:0o711});
await chmod('/workspaces',0o711);
for (const [id,uid] of [['a',200001],['b',200002]]) {
 const base='/workspaces/research_'+id;
 await mkdir(base,{mode:0o750});await chown(base,0,uid);
 for(const dir of ['recon','research','findings','evidence']) {
  await mkdir(base+'/'+dir,{mode:0o700});await chown(base+'/'+dir,uid,uid);
 }
 for(const name of ['scope.md','AGENTS.md','recon/hosts.json','research/plan.md','research/coverage.json','findings/notes.md','findings/hypotheses.json','evidence/ref.json']) {
  await writeFile(base+'/'+name,'PRIVATE_'+id);await chmod(base+'/'+name,name.includes('/')?0o600:0o440);await chown(base+'/'+name,name.includes('/')?uid:0,uid);
 }
 await mkdir('/private-homes/'+id,{mode:0o700});await chown('/private-homes/'+id,uid,uid);
 const binding={v:1,uid,gid:uid,targetId:id,workspaceId:'research_'+id,sessionId:'session_'+id,policySha256:id.repeat(64),state:'active'};
 const path='/var/lib/bughunter-identities/active/'+uid+'.json';await writeFile(path,JSON.stringify(binding));await chown(path,0,uid);await chmod(path,0o440);
}
const consumer=${JSON.stringify(await readFile(new URL('./workspaceIdentityConsumer.mjs',import.meta.url),'utf8'))};
await writeFile('/tmp/consumer.mjs',consumer);
const result=spawnSync('setpriv',['--reuid=200001','--regid=200001','--clear-groups','--no-new-privs','node','/tmp/consumer.mjs'],{stdio:'inherit',env:{PATH:process.env.PATH}});
process.exitCode=result.status??1;
`;
const {stdout,stderr}=await exec('docker',['run','--rm','--network','none','--cap-drop','ALL','--cap-add','CHOWN','--cap-add','SETUID','--cap-add','SETGID','--cap-add','DAC_OVERRIDE','--mount',`type=bind,source=${modulePath},target=/binding.mjs,readonly`,'--entrypoint','node','bughunter-m7-research:local','--input-type=module','-e',fixture],{timeout:30000,maxBuffer:65536});
process.stdout.write(stdout);process.stderr.write(stderr);
