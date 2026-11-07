// Executed by the actual dedicated-UID tmux server as a new window.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {openConsoleWorkspace,openTrustedConsoleWorkspace} from '/opt/bughunter/docker/research/validator/console-files.mjs';
const [expectedUid,foreignUid,foreignPid]=process.argv.slice(2).map(Number);
const own='/workspaces/research_m8-alice',foreign='/workspaces/research_m8-bob';
const credentials=fs.readFileSync('/proc/self/status','utf8');
const results={id:spawnSync('id',[],{encoding:'utf8'}).stdout.trim(),noNewPrivs:/^NoNewPrivs:\s*(.*)$/m.exec(credentials)[1],capBnd:/^CapBnd:\s*(.*)$/m.exec(credentials)[1],uid:process.getuid(),gid:process.getgid(),groups:process.getgroups(),cwd:process.cwd(),capEff:/^CapEff:\s*(.*)$/m.exec(fs.readFileSync('/proc/self/status','utf8'))[1],denied:0};
function deny(fn){try{fn();throw new Error('UNEXPECTED_ACCESS');}catch(error){if(!['EACCES','EPERM'].includes(error.code))throw error;results.denied++;}}
try {
 const initial=await openConsoleWorkspace(own);await initial.root.close();
 const home='/var/lib/bughunter-homes/'+expectedUid;
 for(const [path,uid,gid,mode] of [[own,0,expectedUid,0o750],[own+'/scope.md',0,expectedUid,0o440],[own+'/.agents/bughunter/policy.json',0,expectedUid,0o440],[own+'/findings',expectedUid,expectedUid,0o700],[home,0,expectedUid,0o750],[home+'/home',expectedUid,expectedUid,0o700],[home+'/home/run',expectedUid,expectedUid,0o700],['/var/lib/bughunter-identities/active/'+expectedUid+'/binding.json',0,expectedUid,0o440]]) {
  const value=fs.statSync(path);if(value.uid!==uid||value.gid!==gid||(value.mode&0o7777)!==mode)throw new Error('UNEXPECTED_OWNERSHIP_OR_MODE');
 }
 deny(()=>fs.appendFileSync(own+'/scope.md','DENIED_FIXTURE'));
 deny(()=>fs.chmodSync(own,0o777));deny(()=>fs.chmodSync(own+'/.agents/bughunter/policy.json',0o666));

 if(results.noNewPrivs!=='1'||results.capBnd!=='0000000000000000')throw new Error('PRIVILEGE_BOUNDARY');
 const regain=spawnSync('setpriv',['--reuid=1000','id'],{encoding:'utf8'});if(regain.status===0)throw new Error('LEGACY_UID_REGAINED');
 const ipc=spawnSync('python3',['-c',"import socket;s=socket.socket(socket.AF_UNIX);s.connect('/run/bughunter-broker/control.sock')"],{encoding:'utf8'});if(ipc.status===0||!ipc.stderr.includes('Permission denied'))throw new Error('BROKER_IPC_ACCESS');
 if(results.uid!==expectedUid||results.gid!==expectedUid||results.groups.some(g=>g!==expectedUid)||results.cwd!==own||results.capEff!=='0000000000000000')throw new Error('WRONG_RUNTIME');
 for(const path of ['scope.md','.agents/bughunter/AGENTS.md','.agents/bughunter/policy.json','.agents/bughunter/session.json','recon','research','research/plan.md','research/coverage.md','findings/notes.md','findings/hypotheses.json','requests/burp/README.md'])deny(()=>fs.readFileSync(foreign+'/'+path));
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
 for(const args of [['list-sessions'],['attach-session','-t','=bughunter_claude_m8-bob'],['send-keys','-t','=bughunter_claude_m8-bob','FIXTURE_DENIED'],['capture-pane','-p','-t','=bughunter_claude_m8-bob'],['kill-session','-t','=bughunter_claude_m8-bob']]) {
  const tmux=spawnSync('tmux',['-S','/var/lib/bughunter-homes/'+foreignUid+'/home/run/tmux.sock',...args],{encoding:'utf8'});if(tmux.status===0||!tmux.stderr.includes('Permission denied'))throw new Error('FOREIGN_TMUX');
 }
 deny(()=>process.kill(foreignPid,0));
 const w=await openConsoleWorkspace(own);await w.root.close();
 for(const read of [()=>openConsoleWorkspace(foreign),()=>openTrustedConsoleWorkspace(foreign)]){let denied=false;try{const w=await read();await w.root.close();}catch{denied=true;}if(!denied)throw new Error('FOREIGN_VALIDATOR');}
 deny(()=>fs.readFileSync('/var/lib/bughunter-homes/'+foreignUid+'/home/.claude/bughunter-mcp.json'));
 deny(()=>fs.readFileSync('/var/lib/bughunter-homes/'+foreignUid+'/home/.codex/state_5.sqlite'));
 deny(()=>fs.linkSync('/var/lib/bughunter-identities/active/'+foreignUid+'/binding.json',own+'/findings/foreign-binding'));
 for(const path of ['scope.md','.agents/bughunter/AGENTS.md','recon/hosts.json','research/plan.md','research/coverage.md','findings/hypotheses.json'])fs.readFileSync(own+'/'+path);
 fs.appendFileSync(own+'/findings/notes.md','\nISOLATED_NOTE');
 results.status='KERNEL_RUNTIME_PASS';
} catch(error){results.status='FAIL';results.code=error.code??error.message;}
fs.writeFileSync(own+'/findings/isolation-result.json',JSON.stringify(results));
