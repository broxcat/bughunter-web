'use client';
import {useState} from 'react';
import type {EvidenceLink,EvidenceView} from '@/lib/evidenceVault';
import {Button} from './ui/Button';
const field='block w-full rounded border border-border bg-surface p-2 text-sm';
export default function EvidencePanel({targetId,sessionId,link,reportId}:{targetId:string;sessionId?:string;link?:EvidenceLink;reportId?:string}){
 const [items,setItems]=useState<EvidenceView[]|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[kind,setKind]=useState('RECON_ARTIFACT');
 const [cursors,setCursors]=useState<Array<string|undefined>>([undefined]),[pageIndex,setPageIndex]=useState(0),[nextCursor,setNextCursor]=useState<string|null>(null),[notice,setNotice]=useState('');
 const url='/api/evidence/'+encodeURIComponent(targetId),filter=link?link.entity==='hypothesis'?'hypothesisId':link.entity==='finding'?'findingId':'coverageEventId':reportId?'reportId':null;
 const load=async(before?:string)=>{const q=new URLSearchParams();if(filter)q.set(filter,link?.id??reportId!);if(before)q.set('before',before);
  const r=await fetch(url+'?'+q,{cache:'no-store'});if(!r.ok)throw new Error('Evidence unavailable');const j=await r.json();setItems(j.items);setNextCursor(j.nextCursor);if(j.reset){setCursors([undefined]);setPageIndex(0);setNotice('Evidence changed; showing newest retained records.');}else setNotice('');return Boolean(j.reset);};
 const open=async(index=pageIndex,before=cursors[index])=>{setBusy(true);setError('');try{const reset=await load(before);if(!reset)setPageIndex(index);}catch(e){setError(e instanceof Error?e.message:'Evidence unavailable');}finally{setBusy(false);}};
 const older=async()=>{if(!nextCursor)return;const next=[...cursors.slice(0,pageIndex+1),nextCursor];setCursors(next);await open(pageIndex+1,nextCursor);};
 const submit=async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();const form=event.currentTarget,data=new FormData(form);setBusy(true);setError('');try{
  const existing=String(data.get('existing')??'').trim();let endpoint=url,body:unknown;
  const selectedLink=link&&link.entity!=='coverage'?{...link,role:String(data.get('role')??link.role)}:link;
  if(existing){if(!selectedLink)throw new Error('Choose a hypothesis, test or Finding to link');endpoint+='/'+encodeURIComponent(existing)+'/links';body=selectedLink;}
  else {const common={kind,description:String(data.get('description')??''),...(selectedLink?{link:selectedLink}:{})};
   body=kind==='RECON_ARTIFACT'?{...common,artifactId:String(data.get('reference')??'')}:{...common,sessionId:sessionId??String(data.get('session')??''),observedAt:new Date().toISOString(),http:{method:data.get('method'),url:data.get('url'),statusCode:Number(data.get('status')),requestExcerpt:String(data.get('request')??''),responseExcerpt:String(data.get('response')??'')}};}
  const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),j=await r.json();if(!r.ok)throw new Error(j.error??'Evidence could not be saved');form.reset();setCursors([undefined]);setPageIndex(0);await load();
 }catch(e){setError(e instanceof Error?e.message:'Evidence could not be saved');}finally{setBusy(false);}};
 return <details aria-label={'Evidence for '+(link?.entity??(reportId?'report':'target'))+' '+(link?.id??reportId??targetId)} className="my-2 text-sm" onToggle={e=>{if(e.currentTarget.open&&items===null&&!busy)void open();}}><summary>Evidence{items?' ('+items.length+')':''}</summary><div className="space-y-3 py-2">{busy&&<p role="status">Loading evidence…</p>}{error&&<p role="alert">{error}</p>}
 {items&&<nav aria-label="Evidence pages" className="flex flex-wrap gap-3"><Button disabled={busy||pageIndex===0} onClick={()=>void open(pageIndex-1)}>Newer evidence</Button><span role="status">Evidence page {pageIndex+1} · {items.length} records</span><Button disabled={busy||!nextCursor} onClick={()=>void older()}>Older evidence</Button></nav>}{notice&&<p role="status">{notice}</p>}
 {items?.map(e=><article key={e.id} className="border-l-2 border-border pl-3"><p className="font-mono break-all">{e.id}</p><p>{e.kind} · {new Date(e.createdAt).toLocaleString()}</p><p className="whitespace-pre-wrap break-words">{e.description}</p><p className="text-xs text-muted">{e.redactionStatus}{e.contentSha256?' · SHA-256 '+e.contentSha256:''}</p>{e.relations?.map((r,i)=><p key={i} className="text-xs break-all">{r.entity} {r.id}{r.role?' · '+r.role:''}{r.revision?' · revision '+r.revision:''}</p>)}<details><summary>Provenance and redacted metadata</summary><pre className="overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify({provenance:e.provenance,metadata:e.metadata},null,2)}</pre></details></article>)}
 {items?.length===0&&<p>No vault evidence linked. Existing legacy references are retained separately.</p>}
 {!reportId&&<details><summary>Register or link evidence</summary><form className="space-y-2 pt-2" onSubmit={e=>void submit(e)}>
 {link&&<label>Existing evidence ID<input name="existing" placeholder="EV-… (reuse without copying content)" className={field}/></label>}
 {link&&link.entity!=='coverage'&&<label>Relationship<select name="role" aria-label="Evidence relationship" className={field} defaultValue={link.role}>{['SUPPORTS','REFUTES','CONTEXT'].map(r=><option key={r}>{r}</option>)}</select></label>}
 <label>Type<select aria-label="Evidence type" className={field} value={kind} onChange={e=>setKind(e.target.value)}>{['RECON_ARTIFACT','HTTP_REQUEST_RESPONSE'].map(k=><option key={k}>{k}</option>)}</select></label>
 {!sessionId&&kind!=='RECON_ARTIFACT'&&<label>Research session ID<input name="session" className={field}/></label>}
 <label>Short description<input name="description" maxLength={2000} className={field}/></label>
 {kind!=='HTTP_REQUEST_RESPONSE'?<label>Recon artifact ID<input name="reference" className={field}/></label>:<>
 <label>HTTP method<select name="method" aria-label="Evidence HTTP method" className={field}>{['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].map(m=><option key={m}>{m}</option>)}</select></label><label>Observed URL<input name="url" className={field}/></label><label>Response status<input name="status" type="number" min={100} max={599} className={field}/></label><label>Minimal redacted request excerpt<textarea name="request" maxLength={2000} className={field}/></label><label>Minimal redacted response excerpt<textarea name="response" maxLength={2000} className={field}/></label></>}
 <p className="text-xs text-muted">Only relevant redacted metadata is stored. Never include passwords, cookies, Authorization, API keys or unrelated personal data. File and Recon references retain provenance without copying their contents; no raw file is exposed to the browser. Evidence does not validate a Finding.</p>
 <Button size="sm" type="submit" disabled={busy}>Save evidence</Button></form></details>}
 </div></details>;
}
