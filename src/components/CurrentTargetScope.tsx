'use client';
import { useRef, useState } from 'react';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';

/** Fetch on explicit inspection only; Target rendering and Recon polling do no work. */
export default function CurrentTargetScope({programId}:{programId:string}) {
  const [open,setOpen]=useState(false),[text,setText]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const request=useRef(0),url=`/api/programs/${programId}/scope.md`;
  async function view(){
    const id=++request.current;setOpen(true);setLoading(true);setText('');setError('');
    try{const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw new Error('Current scope.md is unavailable. Retry when policy updates have finished.');const body=await response.text();if(request.current===id)setText(body);}
    catch(e){if(request.current===id)setError(e instanceof Error?e.message:'Current Scope unavailable');}
    finally{if(request.current===id)setLoading(false);}
  }
  return <div className="flex flex-wrap items-center gap-3">
    <Button size="sm" variant="secondary" onClick={()=>void view()}>View scope.md</Button>
    <a className="text-sm text-brand" href={url}>Download scope.md</a>
    {open&&<Dialog title="Current Target scope.md" onClose={()=>{request.current++;setOpen(false);}}>
      <p className="mb-4 text-sm text-muted">Current policy and Recon context. Existing Research authorization snapshots remain unchanged.</p>
      {loading&&<p role="status">Loading current Scope…</p>}
      {error&&<div role="alert" className="space-y-3"><p>{error}</p><Button size="sm" onClick={()=>void view()}>Retry</Button></div>}
      {text&&<pre tabIndex={0} aria-label="Current Target scope document" className="max-h-[60dvh] overflow-y-auto whitespace-pre-wrap break-words rounded border border-border bg-background p-3 text-xs">{text}</pre>}
    </Dialog>}
  </div>;
}
