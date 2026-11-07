import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { providerStatus, sessionCommand } from './providers.mjs';
import { launchProfiles, legacyProfile } from '../../../src/lib/research/launchProfiles.mjs';
import { isolatedLauncherEngine } from './broker.mjs';
const execute=promisify(execFile);
// Read-only probes: bounded native help/auth commands, no prompts or inference.
/** @param {string} targetId
 * @param {'codex'|'claude'} provider
 * @param {(file:string,args:string[],options:object)=>Promise<{stdout:string}>} run
 */
export async function launcherEngine(targetId,provider,run=execute) {
  if(run===execute)return isolatedLauncherEngine(targetId,provider);
  const cwd=`/workspaces/research_${targetId}`;
  const status=await providerStatus(provider,run,cwd);
  let profiles=[];
  const options={timeout:5000,killSignal:'SIGKILL',maxBuffer:65536,shell:false,cwd:'/tmp'};
  if(status.installation==='available') {
    try {
      const {stdout:help}=await run(provider,['--help'],options);
      profiles=launchProfiles[provider].filter(profile=>provider==='codex'
        ? profile==='yolo' ? help.includes('--dangerously-bypass-approvals-and-sandbox') : help.includes('--ask-for-approval')&&help.includes('on-request')&&help.includes('--sandbox')&&help.includes('workspace-write')
        : help.includes('--permission-mode')&&help.includes(profile==='plan'?'"plan"':'"manual"'));
    } catch { /* Unsupported or unavailable help fails closed. */ }
  }
  const {name}=sessionCommand(targetId,provider);
  let runningProfile=null;
  try {
    await run('tmux',['has-session','-t',`=${name}`],options);
    const {stdout}=await run('tmux',['show-environment','-t',`=${name}`,'BUGHUNTER_LAUNCH_PROFILE'],options).catch(error=>{if(error.code===1)return {stdout:''};throw error;});
    const recorded=stdout.trim().replace(/^BUGHUNTER_LAUNCH_PROFILE=/,'');
    // Untagged sessions predate profiles and used these exact legacy defaults.
    runningProfile=recorded ? (launchProfiles[provider].includes(recorded)?recorded:null) : legacyProfile(provider);
    if(recorded&&!runningProfile)profiles=[];
  } catch(error) { if(error.code!==1)throw error; /* No running session. */ }
  return {...status,profiles,runningProfile};
}
// Per-host Claude login differs. A bounded single-flight TTL avoids spawning
// probes on every render; neither tokens nor raw outputs enter this cache.
/** @param {{run?:(file:string,args:string[],options:object)=>Promise<{stdout:string}>,now?:()=>number}} [options] */
export function createLauncherSnapshot({run=execute,now=Date.now}={}) {
  const entries=new Map();let active=0;
  return async targetId=>{
    if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(targetId))throw new Error('INVALID_TARGET');
    const old=entries.get(targetId);
    if(old&&(old.pending||old.expires>now()))return old.pending??old.value;
    if(entries.size>=128){const candidate=[...entries].find(([,entry])=>!entry.pending);if(!candidate)throw new Error('LAUNCHER_BUSY');entries.delete(candidate[0]);}
    if(active>=4)throw new Error('LAUNCHER_BUSY');
    active++;
    const entry={expires:0,value:undefined,pending:undefined};
    entry.pending=(async()=>{
      const results=await Promise.allSettled(['codex','claude'].map(provider=>launcherEngine(targetId,provider,run)));
      const failure=results.find(result=>result.status==='rejected');
      if(failure)throw failure.reason;
      const value=results.map(result=>result.value);
      entry.value=value;entry.expires=now()+15000;return value;
    })().finally(()=>{entry.pending=undefined;active--;});
    entries.set(targetId,entry);return entry.pending;
  };
}
