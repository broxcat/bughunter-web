"use client";
import { useEffect, useState } from "react";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import type { SessionState } from "@/lib/targetAuth";
interface SavedAuthentication { id:string;label:string;mode?:'EMAIL_PASSWORD'|'COOKIES'|'BEARER';persona:string|null;reconEnabled:boolean;sessionStatus:SessionState;sessionCheckedAt:string|null;sessionVerifiedAt:string|null;sessionExpiresAt:string|null }
const dateLabel=(value:string|null)=>value&&Number.isFinite(new Date(value).getTime())?new Date(value).toLocaleString():null;
export default function TargetAuthentication({ targetId, disabled = false }: { targetId: string; disabled?: boolean }) {
  const [mode, setMode] = useState<"EMAIL_PASSWORD" | "COOKIES" | "BEARER">("EMAIL_PASSWORD");
  const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [cookie, setCookie] = useState("");
  const [saved, setSaved] = useState<SavedAuthentication[]>([]); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [token,setToken]=useState(''),[personas,setPersonas]=useState<Record<string,string>>({});
  const [cancel, setCancel] = useState<AbortController | null>(null);
  async function reload() { const r = await fetch(`/api/targets/${targetId}/credentials`); if (r.ok) { setSaved((await r.json()).credentials); window.dispatchEvent(new CustomEvent("bughunter-authentication-changed", { detail: targetId })); } }
  useEffect(() => { const c = new AbortController(); fetch(`/api/targets/${targetId}/credentials`, { signal: c.signal }).then(async r => { if (r.ok) setSaved((await r.json()).credentials); }).catch(() => {}); return () => c.abort(); }, [targetId]);
  useEffect(() => () => cancel?.abort(), [cancel]);
  async function test(credentialId?: string) {
    setBusy(true); setMessage(""); const c = new AbortController(); setCancel(c);
    try {
      const r = await fetch(`/api/targets/${targetId}/credentials/test`, { method: "POST", signal: c.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(credentialId ? { credentialId } : mode === "COOKIES" ? { mode, cookies: cookie } : mode==='BEARER'?{mode,bearerToken:token}:{ mode, username, password }) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error ?? "Connection check failed");
      setUsername(""); setPassword(""); setCookie("");setToken('');
      setMessage(data.status === "VALID" ? "✓ Connected — Session valid" : data.status === "UNKNOWN" ? "Connection could not be verified" : "✗ Connection failed — Credentials rejected or session expired");
    } catch (e) { setMessage(e instanceof Error && e.name === "AbortError" ? "Connection check cancelled" : e instanceof Error ? e.message : "Connection check failed"); }
    finally { setPassword(""); setCookie("");setToken(''); setBusy(false); setCancel(null); await reload().catch(() => {}); }
  }
  async function saveMetadata(credentialId:string,data:{persona?:string|null;reconEnabled?:boolean}){
    setBusy(true);setMessage('');
    try{const response=await fetch(`/api/targets/${targetId}/credentials`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({credentialId,...data})});if(!response.ok)throw new Error();const {credential}=await response.json();setSaved(previous=>previous.map(row=>row.id===credentialId?credential:row));setPersonas(previous=>{const next={...previous};delete next[credentialId];return next;});window.dispatchEvent(new CustomEvent('bughunter-authentication-changed',{detail:targetId}));}
    catch{setMessage('Unable to update authentication metadata. Review your access and try again.');}finally{setBusy(false);}
  }
  return <Card className="space-y-4 p-4" id="authentication">
    <h2 className="font-semibold">Authentication</h2>
    <p className="text-sm text-muted">Test connection saves encrypted authentication. Enable a verified session explicitly for Recon. Credentials are not exported to Research.</p>
    <form onSubmit={e => { e.preventDefault(); void test(); }} className="space-y-3">
      <fieldset disabled={disabled || busy} className="space-y-3"><legend>Authentication method</legend>
        <label className="block"><input type="radio" name="authentication-method" checked={mode === "EMAIL_PASSWORD"} onChange={() => { setMode("EMAIL_PASSWORD"); setPassword(""); setCookie("");setToken(''); }} /> Username / password</label>
        <label className="block"><input type="radio" name="authentication-method" checked={mode === "COOKIES"} onChange={() => { setMode("COOKIES"); setPassword("");setToken(''); }} /> Session cookie</label>
        <label className="block"><input type="radio" name="authentication-method" checked={mode==='BEARER'} onChange={()=>{setMode('BEARER');setPassword('');setCookie('');}}/> Bearer token</label>
        {mode === "EMAIL_PASSWORD" ? <><label className="block">Username<input required autoComplete="off" value={username} onChange={e => setUsername(e.target.value)} className="block w-full rounded border border-border bg-surface p-2" /></label><label className="block">Password<input required type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} className="block w-full rounded border border-border bg-surface p-2" /></label></> : mode==='COOKIES'?<label className="block">Session cookie<input required aria-label="Session cookie value" type="password" autoComplete="off" value={cookie} onChange={e => setCookie(e.target.value)} className="block w-full rounded border border-border bg-surface p-2" /></label>:<label className="block">Bearer token<input required aria-label="Bearer token value" type="password" autoComplete="off" value={token} onChange={event=>setToken(event.target.value)} className="block w-full rounded border border-border bg-surface p-2"/></label>}
        <Button type="submit" disabled={disabled || busy}>{busy ? "Checking…" : "Test connection"}</Button>
      </fieldset>
    </form>
    {busy && cancel && <Button variant="secondary" onClick={() => cancel.abort()}>Cancel connection check</Button>}
    {message && <p role="status">{message}</p>}
    {saved.map(s => <section key={s.id} aria-label={'Saved authentication '+s.label} className="space-y-2 rounded border border-border p-3">
      <p>{s.label} — {s.sessionStatus==='VALID'?'✓ Connected':s.sessionStatus==='UNKNOWN'?'Not checked / unable to verify':'✗ Connection failed'}</p><p className="text-sm">Session {s.sessionStatus.toLowerCase()}</p>
      <p className="text-xs text-muted">Last verified: {dateLabel(s.sessionVerifiedAt)??'Not established'} · Expires: {dateLabel(s.sessionExpiresAt)??'Not recorded'}{s.sessionCheckedAt&&<> · Last checked: {dateLabel(s.sessionCheckedAt)??'Unknown'}</>}</p>
      <div className="flex flex-wrap items-end gap-2"><label className="text-sm">Persona <span className="text-muted">(operator-declared)</span><input aria-label={'Persona for '+s.label} maxLength={80} disabled={busy} value={personas[s.id]??s.persona??''} onChange={event=>setPersonas({...personas,[s.id]:event.target.value})} placeholder="User, Manager…" className="block rounded border border-border bg-surface p-2"/></label><Button size="sm" variant="secondary" disabled={busy||(personas[s.id]??s.persona??'').trim()===(s.persona??'')} onClick={()=>void saveMetadata(s.id,{persona:(personas[s.id]??'').trim()||null})}>Save persona</Button></div>
      <p className="text-xs text-muted">This label does not prove privileges or authorization.</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" role="switch" aria-label={'Use for Recon for '+s.label} checked={!!s.reconEnabled} disabled={busy||(disabled&&!s.reconEnabled)} onChange={event=>void saveMetadata(s.id,{reconEnabled:event.target.checked})}/>Use for Recon: {s.reconEnabled?'ON':'OFF'}</label>
      {s.reconEnabled&&s.sessionStatus!=='VALID'&&<p className="text-sm text-muted">Enabled, but a verified, unexpired session is required before Recon can use it.</p>}
      <div className="flex gap-2"><Button size="sm" variant="secondary" disabled={busy || disabled} onClick={() => void test(s.id)}>Test connection</Button><Button size="sm" variant="danger" disabled={busy} onClick={async () => { try{const r=await fetch(`/api/targets/${targetId}/credentials?credentialId=${encodeURIComponent(s.id)}`,{method:'DELETE'});if(!r.ok)throw new Error();await reload();}catch{setMessage('Unable to remove this authentication.');} }}>Remove</Button></div>
    </section>)}
    <details><summary>Advanced</summary><p className="mt-2 text-sm text-muted">Login forms and session checks are detected automatically. Additional test accounts can improve access-control coverage. Unsupported sign-in flows remain unverified.</p></details>
  </Card>;
}
