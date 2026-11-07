// Dedicated identity primitive probe, launched only inside disposable fixture.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {readRuntimeBinding,authorizeRuntimeWorkspace} from '/binding.mjs';
const own='/workspaces/research_a',foreign='/workspaces/research_b';
const results={uid:process.getuid(),gid:process.getgid(),groups:process.getgroups(),capEff:/^CapEff:\s*(.*)$/m.exec(fs.readFileSync('/proc/self/status','utf8'))[1],denied:0};
function deny(fn){try{fn();throw new Error('UNEXPECTED_ACCESS');}catch(e){if(!['EACCES','EPERM','EXDEV'].includes(e.code))throw e;results.denied++;}}
for(const path of ['scope.md','AGENTS.md','recon/hosts.json','research/plan.md','research/coverage.json','findings/notes.md','findings/hypotheses.json','evidence/ref.json'])deny(()=>fs.readFileSync(foreign+'/'+path));
for(const fn of [()=>fs.writeFileSync(foreign+'/findings/new','bad'),()=>fs.appendFileSync(foreign+'/findings/notes.md','bad'),()=>fs.truncateSync(foreign+'/findings/notes.md'),()=>fs.renameSync(foreign+'/findings/notes.md',foreign+'/findings/renamed'),()=>fs.unlinkSync(foreign+'/findings/notes.md'),()=>fs.readdirSync(foreign),()=>fs.readdirSync('/workspaces'),()=>fs.statSync(foreign+'/scope.md')])deny(fn);
fs.symlinkSync(foreign,own+'/findings/link');fs.symlinkSync('link',own+'/findings/nested');
for(const path of [own+'/../research_b/scope.md',own+'/findings/link/scope.md',own+'/findings/nested/scope.md',own+'/findings/../findings/link/scope.md'])deny(()=>fs.readFileSync(path));
fs.renameSync(own+'/findings/link',own+'/findings/renamed-link');deny(()=>fs.readFileSync(own+'/findings/renamed-link/scope.md'));
deny(()=>fs.linkSync(foreign+'/findings/notes.md',own+'/findings/hardlink'));
const child=spawnSync('node',['-e','require("fs").readFileSync('+JSON.stringify(foreign+'/scope.md')+')'],{encoding:'utf8'});if(child.status===0||!child.stderr.includes('EACCES'))throw new Error('CHILD_BOUNDARY');
const bound=await readRuntimeBinding();if(bound.targetId!=='a')throw new Error('WRONG_BINDING');
let opened=false;try{await authorizeRuntimeWorkspace(async()=>{opened=true;},foreign);throw new Error('FOREIGN_VALIDATOR_ALLOWED');}catch(e){if(e.message!=='RESEARCH_IDENTITY_DENIED'||opened)throw e;}
deny(()=>fs.writeFileSync('/var/lib/bughunter-identities/active/200001/binding.json','{}'));
deny(()=>fs.readFileSync('/var/lib/bughunter-identities/active/200002/binding.json'));
fs.appendFileSync(own+'/findings/notes.md',' preserved');if(!fs.readFileSync(own+'/scope.md','utf8').includes('PRIVATE_a'))throw new Error('OWN_READ');
if(results.uid!==200001||results.gid!==200001||results.groups.some(g=>g!==200001)||results.capEff!=='0000000000000000')throw new Error('WRONG_OS_IDENTITY');
console.log(JSON.stringify({...results,ownRead:true,ownWrite:true,foreignValidatorDeniedBeforeOpen:true,childDenied:true,status:'PRIMITIVE_PASS_ONLY'}));
