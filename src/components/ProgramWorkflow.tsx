"use client";
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ProgramData } from './ProgramForm';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import ScanLogViewer from './ScanLogViewer';
import ResearchTerminal from './ResearchTerminal';
type Run = {id:string;status:string;dispatch:string;outcome:string|null;createdAt:string;error:string|null;discovered:number;added:number;excluded:number};
export default function ProgramWorkflow({ program }: {program:ProgramData}) {
  const router=useRouter();
  const [tab,setTab]=useState('Overview'),[runs,setRuns]=useState<Run[]>([]),[hosts,setHosts]=useState(program.targets);
  const [selected,setSelected]=useState<string|null>(null),[contextId,setContextId]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const refresh=useCallback(async()=>{
    const [r,h]=await Promise.all([fetch(`/api/programs/${program.id}/recon`,{cache:'no-store'}),fetch(`/api/programs/${program.id}/hosts`,{cache:'no-store'})]);
    if(!r.ok||!h.ok) throw new Error('Unable to refresh target activity');
    setRuns(await r.json()); setHosts((await h.json()).filter((host:{active:boolean})=>host.active));
  },[program.id]);
  useEffect(()=>{
    let disposed=false;
    const poll=()=>{if(!disposed)void refresh().catch(e=>{if(!disposed)setError(e.message);});};
    poll();const timer=setInterval(poll,2000);return()=>{disposed=true;clearInterval(timer);};
  },[refresh]);
  async function start(){setBusy(true);setError('');try{const r=await fetch(`/api/programs/${program.id}/recon`,{method:'POST'});const json=await r.json();if(!r.ok)throw new Error(json.error);setSelected(json.id);await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function consoleContext(){setBusy(true);setError('');try{const r=await fetch(`/api/programs/${program.id}/context`,{method:'POST'});const json=await r.json();if(!r.ok)throw new Error(json.error);setContextId(json.contextId);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function remove(){
    if(!window.confirm(`Supprimer définitivement la target « ${program.companyName} » ? Tous ses hosts, scopes exclusifs, identifiants, sessions Codex, RECON, résultats, logs et workspaces seront supprimés. Cette opération est irréversible.`))return;
    setBusy(true);setError('');
    try{const r=await fetch(`/api/programs/${program.id}`,{method:'DELETE'});const json=await r.json();if(!r.ok)throw new Error(json.error);router.push('/targets?deleted=1');}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const current=runs.find(r=>r.id===selected)??runs[0];
  return <div className="space-y-5">
    <nav aria-label="Target workflow" className="flex flex-wrap gap-2">{['Overview','Scopes / Hosts','RECON','Codex Console','Settings'].map(name=><Button key={name} variant={tab===name?'primary':'secondary'} onClick={()=>setTab(name)}>{name}</Button>)}</nav>
    {error&&<p role="alert" className="text-danger">{error}</p>}
    {program.deletingAt&&<p role="status">Suppression en cours : les nouveaux lancements sont bloqués. Relancez la suppression dans Settings si nécessaire.</p>}
    {tab==='Overview'&&<Card className="space-y-3 p-5"><h2 className="text-xl font-semibold">Program scope and rules</h2><p>Authorized rules: {program.scopeRules.join(', ')||'None configured'}</p><p>Excluded: {program.outOfScope.join(', ')||'None recorded'}</p><p className="whitespace-pre-wrap">{program.rulesOfEngagement||'No additional rules of engagement recorded.'}</p><p>Inventory: {hosts.length} hosts · {runs.length} recent Recon runs</p></Card>}
    {tab==='Scopes / Hosts'&&<Card className="space-y-3 p-5"><h2 className="text-xl font-semibold">Scopes / Hosts — {hosts.length}</h2><p>Discoveries are added incrementally only when authorized. Exclusions always win.</p>{hosts.map(h=><p key={h.id}><Link className="text-brand" href={`/hosts/${h.id}`}>{h.host}</Link></p>)}{!hosts.length&&<p>No discovered hosts yet. Configure authorized scope rules, then launch Recon.</p>}<Link className="text-brand" href={`/scopes/${program.id}`}>Manage Scope →</Link></Card>}
    {tab==='RECON'&&<div className="space-y-4"><p>Passive enumeration from official scope rules, using certificate transparency. No automatic active scans. Processing continues after you leave this page.</p><Button disabled={busy||!!program.deletingAt||!program.scopeRules.length||runs.some(r=>['QUEUED','RUNNING'].includes(r.status))} onClick={()=>void start()}>Lancer le RECON</Button>{current&&<><p role="status">{current.status} · {current.discovered} discovered · {current.added} newly added · {current.excluded} excluded / outside scope</p>{current.error&&<p role="alert">{current.error}</p>}<ScanLogViewer scanRunId={current.id}/></>}<h2 className="font-semibold">Execution history</h2>{runs.map(run=><p key={run.id}><Button variant="ghost" onClick={()=>setSelected(run.id)}>{new Date(run.createdAt).toLocaleString()} · {run.status} · {run.outcome??run.dispatch}</Button></p>)}</div>}
    <div hidden={tab!=='Codex Console'} className="space-y-3"><p>Global program context, passive Recon and inventory. Read scope.md; recon/hosts.json refreshes every 20 seconds while connected. Host consoles retain their focused context and parent program rules.</p>{contextId?<ResearchTerminal embedded targetId={contextId} company={program.companyName} host="Program context · passive" requiredUserAgent={program.requiredUserAgent}/>:<Button disabled={busy||!!program.deletingAt} onClick={()=>void consoleContext()}>Launch Codex Console</Button>}</div>
    {tab==='Settings'&&<Card className="space-y-4 p-5"><h2 className="text-xl font-semibold">Delete Target</h2><p>Supprime définitivement la target et toutes ses données exclusives, après confirmation de l’arrêt des RECON et consoles. Les ressources partagées sont préservées.</p><Button disabled={busy} variant="danger" onClick={()=>void remove()}>{busy?'Suppression…':'Supprimer la target'}</Button></Card>}
  </div>;
}
