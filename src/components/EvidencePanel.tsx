'use client';
import {useState} from 'react';
import type {EvidenceLink,EvidenceView} from '@/lib/evidenceVault';
import {Button} from './ui/Button';
const field='block w-full rounded border border-border bg-surface p-2 text-sm';
export default function EvidencePanel({targetId,sessionId,link,reportId}:{targetId:string;sessionId?:string;link?:EvidenceLink;reportId?:string}){
 const [items,setItems]=useState<EvidenceView[]|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[kind,setKind]=useState('RECON_ARTIFACT');
 const url='/api/evidence/'+encodeURIComponent(targetId),filter=link?link.entity==='hypothesis'?'hypothesisId':link.entity==='finding'?'findingId':'coverageEventId':reportId?'reportId':null;
 const load=async()=>{const r=await fetch(url+(filter?'?'+filter+'='+encodeURIComponent(link?.id??reportId!):''),{cache:'no-store'});if(!r.ok)throw new Error('Evidence unavailable');const j=await r.json();setItems(j.items);if(j.truncated)setError('Bounded evidence list; further records remain retained.');};
 const open=async()=>{setBusy(true);setError('');try{await load();}catch(e){setError(e instanceof Error?e.message:'Evidence unavailable');}finally{setBusy(false);}};
 const submit=async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();const form=event.currentTarget,data=new FormData(form);setBusy(true);setError('');try{
  const existing=String(data.get('existing')??'').trim();let endpoint=url,body:unknown;
  const selectedLink=link&&link.entity!=='coverage'?{...link,role:String(data.get('role')??link.role)}:link;
  if(existing){if(!selectedLink)throw new Error('Choose a hypothesis, test or Finding to link');endpoint+='/'+encodeURIComponent(existing)+'/links';body=selectedLink;}
  else {const common={kind,description:String(data.get('description')??''),...(selectedLink?{link:selectedLink}:{})};
   body=kind==='RECON_ARTIFACT'?{...common,artifactId:String(data.get('reference')??'')}:kind==='HTTP_REQUEST_RESPONSE'?{...common,sessionId:sessionId??String(data.get('session')??''),observedAt:new Date().toISOString(),http:{method:data.get('method'),url:data.get('url'),statusCode:Number(data.get('status')),requestExcerpt:String(data.get('request')??''),responseExcerpt:String(data.get('response')??'')}}:{...common,sessionId:sessionId??String(data.get('session')??''),ref:String(data.get('reference')??'')};}
  const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),j=await r.json();if(!r.ok)throw new Error(j.error??'Evidence could not be saved');form.reset();await load();
 }catch(e){setError(e instanceof Error?e.message:'Evidence could not be saved');}finally{setBusy(false);}};
 return <details aria-label={'Evidence for '+(link?.entity??(reportId?'report':'target'))+' '+(link?.id??reportId??targetId)} className="my-2 text-sm" onToggle={e=>{if(e.currentTarget.open&&items===null&&!busy)void open();}}><summary>Evidence{items?' ('+items.length+')':''}</summary><div className="space-y-3 py-2">{busy&&<p role="status">Loading evidence…</p>}{error&&<p role="alert">{error}</p>}
 {items?.map(e=><article key={e.id} className="border-l-2 border-border pl-3"><p className="font-mono break-all">{e.id}</p><p>{e.kind} · {new Date(e.createdAt).toLocaleString()}</p><p className="whitespace-pre-wrap break-words">{e.description}</p><p className="text-xs text-muted">{e.redactionStatus}{e.contentSha256?' · SHA-256 '+e.contentSha256:''}</p>{e.relations?.map((r,i)=><p key={i} className="text-xs break-all">{r.entity} {r.id}{r.role?' · '+r.role:''}{r.revision?' · revision '+r.revision:''}</p>)}<details><summary>Provenance and redacted metadata</summary><pre className="overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify({provenance:e.provenance,metadata:e.metadata},null,2)}</pre></details></article>)}
 {items?.length===0&&<p>No Vault evidence linked. Existing legacy references are retained separately.</p>}
 {!reportId&&<details><summary>Register or link evidence</summary><form className="space-y-2 pt-2" onSubmit={e=>void submit(e)}>
 {link&&<label>Existing Evidence ID<input name="existing" placeholder="EV-… (reuse without copying content)" className={field}/></label>}
 {link&&link.entity!=='coverage'&&<label>Relationship<select name="role" aria-label="Evidence relationship" className={field} defaultValue={link.role}>{['SUPPORTS','REFUTES','CONTEXT'].map(r=><option key={r}>{r}</option>)}</select></label>}
 <label>Type<select aria-label="Evidence type" className={field} value={kind} onChange={e=>setKind(e.target.value)}>{['RECON_ARTIFACT','HTTP_REQUEST_RESPONSE','BURP_REFERENCE','RESEARCH_EVIDENCE'].map(k=><option key={k}>{k}</option>)}</select></label>
 {!sessionId&&kind!=='RECON_ARTIFACT'&&<label>Research Session ID<input name="session" className={field}/></label>}
 <label>Short description<input name="description" maxLength={2000} className={field}/></label>
 {kind!=='HTTP_REQUEST_RESPONSE'?<label>{kind==='RECON_ARTIFACT'?'Recon Artifact ID':'Relative workspace reference'}<input name="reference" className={field}/></label>:<>
 <label>HTTP method<select name="method" aria-label="Evidence HTTP method" className={field}>{['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].map(m=><option key={m}>{m}</option>)}</select></label><label>Observed URL<input name="url" className={field}/></label><label>Response status<input name="status" type="number" min={100} max={599} className={field}/></label><label>Minimal redacted request excerpt<textarea name="request" maxLength={2000} className={field}/></label><label>Minimal redacted response excerpt<textarea name="response" maxLength={2000} className={field}/></label></>}
 <p className="text-xs text-muted">Only relevant redacted metadata is stored. Never include passwords, cookies, Authorization, API keys or unrelated personal data. File and Recon references retain provenance without copying their contents; no raw file is exposed to the browser. Evidence does not validate a Finding.</p>
 <Button size="sm" type="submit" disabled={busy}>Save evidence</Button></form></details>}
 </div></details>;
}
