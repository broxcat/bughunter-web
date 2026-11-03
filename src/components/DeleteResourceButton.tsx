'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
export default function DeleteResourceButton({url,kind,name,redirectTo}:{url:string;kind:'Target'|'console';name:string;redirectTo?:string}){
  const[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');const router=useRouter();
  const remove=async()=>{setBusy(true);setError('');try{const r=await fetch(url,{method:'DELETE'});if(!r.ok)throw new Error((await r.json()).error??'Deletion incomplete; retry');setOpen(false);if(redirectTo)router.push(redirectTo);router.refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <><Button variant="ghost" size="sm" onClick={()=>setOpen(true)}>{kind==='Target'?'Delete Target':'Delete'}</Button>{open&&<Dialog title={`Delete ${kind}?`} onClose={()=>{if(!busy)setOpen(false);}}><p className="break-all">{name}</p><p className="my-4 text-sm">{kind==='Target'?'This permanently deletes this Target, its Scope Assets, Recon evidence, Findings, Research consoles and summaries. Active scans and consoles will be stopped.':'This stops this console and permanently deletes its workspace and conversations. Target, Recon, Findings, global settings and provider authentication are preserved.'}</p>{error&&<p className="my-3 text-danger" role="alert">{error}</p>}<Button variant="danger" disabled={busy} onClick={()=>void remove()}>{busy?'Deleting…':'Confirm deletion'}</Button></Dialog>}</>;
}
