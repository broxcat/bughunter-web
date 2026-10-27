"use client";
import { useEffect, useState } from "react";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import type { SessionState } from "@/lib/targetAuth";
interface SavedAuthentication { id: string; label: string; sessionStatus: SessionState; sessionCheckedAt: string | null }
export default function TargetAuthentication({ targetId, disabled = false }: { targetId: string; disabled?: boolean }) {
  const [mode, setMode] = useState<"EMAIL_PASSWORD" | "COOKIES">("EMAIL_PASSWORD");
  const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [cookie, setCookie] = useState("");
  const [saved, setSaved] = useState<SavedAuthentication[]>([]); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [cancel, setCancel] = useState<AbortController | null>(null);
  async function reload() { const r = await fetch(`/api/targets/${targetId}/credentials`); if (r.ok) { setSaved((await r.json()).credentials); window.dispatchEvent(new CustomEvent("bughunter-authentication-changed", { detail: targetId })); } }
  useEffect(() => { const c = new AbortController(); fetch(`/api/targets/${targetId}/credentials`, { signal: c.signal }).then(async r => { if (r.ok) setSaved((await r.json()).credentials); }).catch(() => {}); return () => c.abort(); }, [targetId]);
  useEffect(() => () => cancel?.abort(), [cancel]);
  async function test(credentialId?: string) {
    setBusy(true); setMessage(""); const c = new AbortController(); setCancel(c);
    try {
      const r = await fetch(`/api/targets/${targetId}/credentials/test`, { method: "POST", signal: c.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(credentialId ? { credentialId } : mode === "COOKIES" ? { mode, cookies: cookie } : { mode, username, password }) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error ?? "Connection check failed");
      setUsername(""); setPassword(""); setCookie("");
      setMessage(data.status === "VALID" ? "✓ Connected — Session valid" : data.status === "UNKNOWN" ? "Connection could not be verified" : "✗ Connection failed — Credentials rejected or session expired");
    } catch (e) { setMessage(e instanceof Error && e.name === "AbortError" ? "Connection check cancelled" : e instanceof Error ? e.message : "Connection check failed"); }
    finally { setPassword(""); setCookie(""); setBusy(false); setCancel(null); await reload().catch(() => {}); }
  }
  return <Card className="space-y-4 p-4" id="authentication">
    <h2 className="font-semibold">Authentication</h2>
    <p className="text-sm text-muted">Test connection saves this authentication for future Recon scans. Credentials are not exported to Research.</p>
    <form onSubmit={e => { e.preventDefault(); void test(); }} className="space-y-3">
      <fieldset disabled={disabled || busy} className="space-y-3"><legend>Authentication method</legend>
        <label className="block"><input type="radio" name="authentication-method" checked={mode === "EMAIL_PASSWORD"} onChange={() => { setMode("EMAIL_PASSWORD"); setPassword(""); setCookie(""); }} /> Username / password</label>
        <label className="block"><input type="radio" name="authentication-method" checked={mode === "COOKIES"} onChange={() => { setMode("COOKIES"); setPassword(""); }} /> Session cookie</label>
        {mode === "EMAIL_PASSWORD" ? <><label className="block">Username<input required autoComplete="off" value={username} onChange={e => setUsername(e.target.value)} className="block w-full rounded border border-border bg-surface p-2" /></label><label className="block">Password<input required type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} className="block w-full rounded border border-border bg-surface p-2" /></label></> : <label className="block">Session cookie<input required aria-label="Session cookie value" type="password" autoComplete="off" value={cookie} onChange={e => setCookie(e.target.value)} className="block w-full rounded border border-border bg-surface p-2" /></label>}
        <Button type="submit" disabled={disabled || busy}>{busy ? "Checking…" : "Test connection"}</Button>
      </fieldset>
    </form>
    {busy && <Button variant="secondary" onClick={() => cancel?.abort()}>Cancel connection check</Button>}
    {message && <p role="status">{message}</p>}
    {saved.map(s => <div key={s.id} className="space-y-1 rounded border border-border p-3"><p>{s.label} — {s.sessionStatus === "VALID" ? "✓ Connected" : s.sessionStatus === "UNKNOWN" ? "Not checked / unable to verify" : "✗ Connection failed"}</p><p className="text-sm">Session {s.sessionStatus.toLowerCase()}</p><p className="text-xs text-muted">Last checked: {s.sessionCheckedAt ? new Date(s.sessionCheckedAt).toLocaleString() : "Never"}</p><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={busy || disabled} onClick={() => void test(s.id)}>Test connection</Button><Button size="sm" variant="danger" disabled={busy} onClick={async () => { const r = await fetch(`/api/targets/${targetId}/credentials?credentialId=${encodeURIComponent(s.id)}`, { method: "DELETE" }); if (r.ok) await reload(); }}>Remove</Button></div></div>)}
    <details><summary>Advanced</summary><p className="mt-2 text-sm text-muted">Login forms and session checks are detected automatically. Additional test accounts can improve access-control coverage. Unsupported sign-in flows remain unverified.</p></details>
  </Card>;
}
