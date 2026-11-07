// Executed by the actual dedicated-UID tmux server as a new window.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {openConsoleWorkspace,openTrustedConsoleWorkspace} from '/opt/bughunter/docker/research/validator/console-files.mjs';
const [expectedUid,foreignUid,foreignPid]=process.argv.slice(2).map(Number);
const own='/workspaces/research_m8-alice',foreign='/workspaces/research_m8-bob';
const results={uid:process.getuid(),gid:process.getgid(),groups:process.getgroups(),cwd:process.cwd(),capEff:/^CapEff:\s*(.*)$/m.exec(fs.readFileSync('/proc/self/status','utf8'))[1],denied:0};
function deny(fn){try{fn();throw new Error('UNEXPECTED_ACCESS');}catch(error){if(!['EACCES','EPERM'].includes(error.code))throw error;results.denied++;}}
try {
 const initial=await openConsoleWorkspace(own);await initial.root.close();
 if(results.uid!==expectedUid||results.gid!==expectedUid||results.groups.some(g=>g!==expectedUid)||results.cwd!==own||results.capEff!=='0000000000000000')throw new Error('WRONG_RUNTIME');
 for(const path of ['scope.md','.agents/bughunter/AGENTS.md','.agents/bughunter/policy.json','.agents/bughunter/session.json','recon','research','findings/notes.md','findings/hypotheses.json','requests/burp/README.md'])deny(()=>fs.readFileSync(foreign+'/'+path));
 for(const fn of [()=>fs.writeFileSync(foreign+'/findings/new','x'),()=>fs.appendFileSync(foreign+'/findings/notes.md','x'),()=>fs.truncateSync(foreign+'/findings/notes.md'),()=>fs.renameSync(foreign+'/findings/notes.md',foreign+'/findings/renamed'),()=>fs.unlinkSync(foreign+'/findings/notes.md'),()=>fs.readdirSync(foreign),()=>fs.readdirSync('/workspaces'),()=>fs.statSync(foreign+'/scope.md')])deny(fn);
 for(const path of [own+'/../research_m8-bob/scope.md',own+'/./../research_m8-bob/scope.md'])deny(()=>fs.readFileSync(path));
 for(const name of ['link','nested','renamed']){try{fs.unlinkSync(own+'/findings/'+name);}catch(error){if(error.code!=='ENOENT')throw error;}}
 const parent=fs.openSync('/workspaces',0x200000);try{deny(()=>fs.readFileSync('/proc/self/fd/'+parent+'/research_m8-bob/scope.md'));}finally{fs.closeSync(parent);}
 deny(()=>fs.renameSync(foreign,foreign+'-renamed'));
 fs.symlinkSync(foreign,own+'/findings/link');fs.symlinkSync('link',own+'/findings/nested');
 deny(()=>fs.readFileSync(own+'/findings/link/scope.md'));deny(()=>fs.readFileSync(own+'/findings/nested/scope.md'));
 fs.renameSync(own+'/findings/link',own+'/findings/renamed');deny(()=>fs.readFileSync(own+'/findings/renamed/scope.md'));
 deny(()=>fs.linkSync(foreign+'/findings/notes.md',own+'/findings/hardlink'));
 for(const name of ['cwd','root'])deny(()=>fs.readlinkSync(`/proc/${foreignPid}/${name}`));
 deny(()=>fs.readdirSync(`/proc/${foreignPid}/fd`));
 deny(()=>fs.readFileSync(`/proc/${foreignPid}/root${foreign}/scope.md`));
 for(const fd of fs.readdirSync('/proc/self/fd')){let path;try{path=fs.readlinkSync('/proc/self/fd/'+fd);}catch(error){if(error.code==='ENOENT')continue;throw error;}if(path?.includes(foreign)||path?.includes('/bughunter-homes/'+foreignUid))throw new Error('FOREIGN_FD_INHERITED');}
 const child=spawnSync('sh',['-c','cat "$1"','probe',foreign+'/scope.md'],{encoding:'utf8'});if(child.status===0||!child.stderr.includes('Permission denied'))throw new Error('CHILD_ACCESS');
 const tmux=spawnSync('tmux',['-S','/var/lib/bughunter-homes/'+foreignUid+'/run/tmux.sock','list-sessions'],{encoding:'utf8'});if(tmux.status===0||!tmux.stderr.includes('Permission denied'))throw new Error('FOREIGN_TMUX');
 const w=await openConsoleWorkspace(own);await w.root.close();
 for(const read of [()=>openConsoleWorkspace(foreign),()=>openTrustedConsoleWorkspace(foreign)]){let denied=false;try{const w=await read();await w.root.close();}catch{denied=true;}if(!denied)throw new Error('FOREIGN_VALIDATOR');}
 deny(()=>fs.readFileSync('/var/lib/bughunter-homes/'+foreignUid+'/.claude/bughunter-mcp.json'));
 for(const path of ['scope.md','.agents/bughunter/AGENTS.md','recon/hosts.json','findings/hypotheses.json'])fs.readFileSync(own+'/'+path);
 fs.appendFileSync(own+'/findings/notes.md','\nISOLATED_NOTE');
 results.status='KERNEL_RUNTIME_PASS';
} catch(error){results.status='FAIL';results.code=error.code??error.message;}
fs.writeFileSync(own+'/findings/isolation-result.json',JSON.stringify(results));
