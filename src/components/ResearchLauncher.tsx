"use client";
import Link from 'next/link';
import {useState} from 'react';
import {launcherStatusSchema,providerName,type ResearchProvider,type LaunchProfile} from '@/lib/research/provider';
import {profileDescription} from '@/lib/research/launchProfiles.mjs';
export default function ResearchLauncher({targetId,host,disabledReason}:{targetId:string;host:string;disabledReason?:string}) {
  const [provider,setProvider]=useState<ResearchProvider>('codex');
  const [profile,setProfile]=useState<LaunchProfile>('standard');
  const [engines,setEngines]=useState<ReturnType<typeof launcherStatusSchema.parse>>();
  const [checking,setChecking]=useState(false),[message,setMessage]=useState('Authentication: unknown. Check native readiness before opening.');
  const engine=engines?.find(row=>row.provider===provider);
  const profiles=engine?.profiles??[];
  const conflict=Boolean(engine?.runningProfile&&engine.runningProfile!==profile);
  async function check() {
    setChecking(true);
    try {
      const response=await fetch(`/api/research-targets/${targetId}/launcher`,{cache:'no-store'});
      if(!response.ok)throw new Error();
      const data=await response.json();const rows=launcherStatusSchema.parse(data.engines);setEngines(rows);const current=rows.find(row=>row.provider===provider);if(current?.runningProfile)setProfile(current.runningProfile);else if(current?.profiles[0])setProfile(current.profiles[0]);setMessage('Readiness checked. Authorization and policy are revalidated on open.');
    }catch{setEngines(undefined);setMessage('Authentication readiness unknown. Retry the check; the native console can also show login requirements.');}
    finally{setChecking(false);}
  }
  return <div className="w-full space-y-3 border-t border-border pt-3" aria-label={`Launcher for ${host}`}>
    <div className="flex flex-wrap items-end gap-3">
      <label>Engine<select aria-label="Engine" disabled={checking} className="ml-2 rounded border border-border bg-surface p-2" value={provider} onChange={event=>{const next=event.target.value as ResearchProvider;setProvider(next);setProfile(engines?.find(row=>row.provider===next)?.runningProfile??'standard');}}>
        {(['codex','claude'] as const).map(value=><option key={value} value={value}>{providerName(value)}</option>)}
      </select></label>
      <label>Launch profile<select aria-label="Launch profile" disabled={checking||!engine} className="ml-2 rounded border border-border bg-surface p-2" value={profile} onChange={event=>setProfile(event.target.value as LaunchProfile)}>
        {!engine&&!profiles.includes(profile)&&<option value={profile}>Check readiness for profiles</option>}
        {profiles.map(value=><option key={value} value={value}>{value==='yolo'?'YOLO':value==='plan'?'Plan':'Standard'}</option>)}
      </select></label>
      <button type="button" className="ui-btn" disabled={checking} onClick={()=>void check()}>{checking?'Checking…':'Check readiness'}</button>
      {!disabledReason&&(!engine||profiles.includes(profile))&&!conflict&&<Link href={`/research/${targetId}?engine=${provider}&profile=${profile}`} className="ui-btn" data-variant="primary" aria-label={`Open console — ${host}`}>Open console</Link>}
      {conflict&&<button className="ui-btn" onClick={()=>setProfile(engine!.runningProfile!)}>Use running {engine!.runningProfile} profile</button>}
    </div>
    <p role="status" className="text-sm text-muted">{engine?`${providerName(provider)}: ${engine.installation} · Authentication: ${engine.authentication==='required'?'Login required':engine.authentication==='authenticated'?'Authenticated':'Unknown'}${engine.version?` · ${engine.version}`:''} · ${engine.runningProfile?`Running: ${engine.runningProfile}`:'No running session'}`:message}</p>
    {engine&&!profiles.length&&<p role="alert">No supported launch profiles verified for this CLI. Check the installed console version and retry readiness.</p>}
    {disabledReason&&<p role="alert">{disabledReason}</p>}
    {conflict&&<p role="alert">This engine already runs with another profile. Reconnect to that profile; changing a selection never stops a persistent console.</p>}
    <p className="text-sm text-muted">{profileDescription(provider,profile)} Separate engine conversations persist for this host. Model selection uses native /model. Local routes and agent configuration are operator-only.</p>
  </div>;
}
