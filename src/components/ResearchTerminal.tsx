"use client";
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { providerName, engineStatusesSchema, type ResearchEngineStatus, type ResearchProvider, type LaunchProfile } from '@/lib/research/provider';
import { terminalHandlesKey } from '@/lib/research/terminalClipboard';
import ResearchReconContext from './ResearchReconContext';
import '@xterm/xterm/css/xterm.css';

export default function ResearchTerminal({ targetId, company, host, requiredUserAgent, embedded = false, initialSelection }: { initialSelection?: {provider:ResearchProvider;profile?:LaunchProfile}; targetId: string; company: string; host: string; requiredUserAgent: string; embedded?: boolean }) {
  const element = useRef<HTMLDivElement>(null);
  const socket = useRef<WebSocket | undefined>(undefined);
  const [selectedProvider, setSelectedProvider] = useState<ResearchProvider>(initialSelection?.provider??'codex');
  const [requestedProvider, setRequestedProvider] = useState<ResearchProvider | undefined>(initialSelection?.provider);
  const [switchTo, setSwitchTo] = useState<ResearchProvider | undefined>();
  const [selectedProfile,setSelectedProfile]=useState<LaunchProfile>(initialSelection?.profile??(initialSelection?.provider==='claude'?'standard':'yolo'));
  const [engines, setEngines] = useState<ResearchEngineStatus[]>([]);
  const [providerState, setProviderState] = useState('checking');
  const [attempt, reconnect] = useState(0), [state, setState] = useState('connecting'), [burp, setBurp] = useState('starting'), [burpDetails, setBurpDetails] = useState('PortSwigger MCP'), [codex, setCodex] = useState('checking'), [error, setError] = useState('');
  useEffect(() => {
    let disposed = false, ws: WebSocket | undefined, terminal: import('@xterm/xterm').Terminal | undefined, observer: ResizeObserver | undefined;
    let renewal: ReturnType<typeof setInterval> | undefined;
    const connect = async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]);
      if (disposed || !element.current) return;
      terminal = new Terminal({ cursorBlink: true, scrollback: 3000, fontSize: 14, fontFamily: getComputedStyle(element.current).getPropertyValue('--font-jetbrains-mono').trim() || 'monospace', theme: { background: '#090d12', foreground: '#d9e2ef' }, allowProposedApi: false });
      terminal.attachCustomKeyEventHandler(event => terminalHandlesKey(event, terminal!.hasSelection()));
      const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(element.current); fit.fit(); terminal.focus();
      setError(''); setState('connecting');
      let selection=requestedProvider?{provider:requestedProvider,...(requestedProvider===initialSelection?.provider&&initialSelection.profile?{profile:initialSelection.profile}:{})}:undefined;
      const ticket = async () => {
        const r = await fetch(`/api/research-targets/${targetId}/terminal`, { method: 'POST', cache: 'no-store', ...(selection ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(selection) } : {}) });
        const data = await r.json(); if (!r.ok) throw new Error(data.error ?? 'Console unavailable'); return data;
      };
      const signed = await ticket(); if (disposed) return;
      selection={provider:signed.provider??'codex',profile:signed.profile??(signed.provider==='claude'?'standard':'yolo')};
      setSelectedProfile(selection.profile!);
      setSelectedProvider(signed.provider ?? 'codex'); setProviderState('checking');
      const url = new URL(`/research-terminal/${targetId}`, window.location.origin); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(url, ['bh-terminal.v1', `ticket.${signed.token}`]);
      socket.current = ws;
      const sendSize = () => { if (disposed) return; fit.fit(); if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols: terminal!.cols, rows: terminal!.rows })); };
      observer = new ResizeObserver(sendSize); observer.observe(element.current);
      terminal.onData(data => { if (ws?.readyState === WebSocket.OPEN) for (const chunk of data.match(/[\s\S]{1,2048}/gu) ?? []) ws.send(JSON.stringify({ type: 'input', data: chunk })); });
      ws.onopen = () => {
        if (disposed) { ws?.close(); return; }
        setState('attaching'); sendSize();
        renewal = setInterval(() => { void ticket().then(t => { if (!disposed && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'renew', token: t.token })); }).catch(e => { setError(e.message); ws?.close(); }); }, 20000);
      };
      ws.onmessage = event => {
        if (disposed) return;
        const message = JSON.parse(event.data);
        if (message.type === 'engine_status') { const result = engineStatusesSchema.safeParse(message.engines); if (result.success) setEngines(result.data); }
        if (message.type === 'ready') { setState('connected'); setSelectedProvider(message.provider ?? 'codex'); if(message.profile)setSelectedProfile(message.profile); }
        if (message.type === 'provider_status') { setCodex(message.authentication === 'authenticated' ? 'signed in' : message.authentication === 'required' ? 'login required' : 'unknown'); setProviderState(`Installation: ${message.installation} · Authentication: ${message.authentication}${message.version ? ` · ${message.version}` : ''}${message.code ? ` · ${message.code}` : ''}`); }
        if (message.type === 'output') terminal?.write(message.data);
        if (message.type === 'status') { setBurp(message.burp); setCodex(message.authentication ?? message.codex ?? 'unknown'); if (message.burpDetails) setBurpDetails(`PortSwigger MCP · ${message.burpDetails.toolCount} tools${message.burpDetails.version ? ` · ${message.burpDetails.version}` : ''} · BugHunter scope controls apply`); }
        if (message.type === 'error') setError(message.code==='PROFILE_CONFLICT'?'This engine is already running with another profile. Return to Research, check readiness and reconnect to its running profile. The existing session was preserved.':message.code==='PROFILE_UNAVAILABLE'?'This profile is not supported by the installed CLI. Check readiness in Research.':message.code);
      };
      ws.onclose = () => { if (renewal) clearInterval(renewal); if (!disposed) setState('disconnected'); };
      ws.onerror = () => { if (!disposed) setError('Terminal connection unavailable. Reconnect when the Research console is ready.'); };
    };
    void connect().catch(e => { if (!disposed) { setError(e.message); setState('unavailable'); } });
    return () => { disposed = true; socket.current = undefined; if (renewal) clearInterval(renewal); observer?.disconnect(); ws?.close(); terminal?.dispose(); };
  }, [targetId, attempt, requestedProvider, initialSelection]);
  return <div className={`flex ${embedded ? "h-[650px] rounded border border-border" : "h-dvh"} w-full flex-col overflow-hidden bg-[#090d12] text-slate-200`}>
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-800 px-3 py-2 text-xs">
      <Link className="text-slate-400 hover:text-white" href="/research">← Research</Link>
      <h1 className="mr-auto truncate text-sm font-medium">{company} / {host}</h1>
      <span className="max-w-48 truncate" title={requiredUserAgent}>UA: {requiredUserAgent}</span><span aria-live="polite">Terminal: {state}</span><span title={providerState}>{selectedProvider === 'codex' ? 'Codex' : 'Claude'}: {codex}</span><span title={burpDetails}>Burp MCP: {burp}</span>
      <label className="flex items-center gap-2">Moteur IA
        <select aria-label="Moteur IA" value={switchTo ?? selectedProvider} className="rounded border border-slate-700 bg-slate-900 p-1" onChange={e => setSwitchTo(e.target.value as ResearchProvider)}>
          {(['codex', 'claude'] as const).map(engine => { const diagnostic = engines.find(row => row.provider === engine); return <option key={engine} value={engine}>{providerName(engine)}{diagnostic ? ` · ${diagnostic.installation} · ${diagnostic.authentication}` : ''}</option>; })}
        </select>
      </label>
      <button className="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800" disabled={burp === 'starting' && state === 'connected'} onClick={() => { if (socket.current?.readyState === WebSocket.OPEN) { setBurp('starting'); socket.current.send(JSON.stringify({ type: 'reconnect_mcp' })); } else reconnect(n => n + 1); }}>Reconnect</button>
    </header>
    {switchTo && switchTo !== selectedProvider && <div className="flex shrink-0 flex-wrap items-center gap-3 bg-slate-900 px-3 py-2 text-sm" role="status">
      <p>Open {providerName(switchTo)}? Each engine keeps its own conversation. The current engine stays available when you return.</p>
      <button className="rounded border px-2 py-1" onClick={() => { window.history.replaceState(null,'',`/research/${targetId}?engine=${switchTo}&profile=${switchTo===initialSelection?.provider&&initialSelection.profile?initialSelection.profile:switchTo==='codex'?'yolo':'standard'}`); setRequestedProvider(switchTo); setSwitchTo(undefined); reconnect(n => n + 1); }}>Open {providerName(switchTo)}</button>
      <button className="rounded border px-2 py-1" onClick={() => setSwitchTo(undefined)}>Cancel</button>
    </div>}
    <p className="shrink-0 px-3 py-1 text-xs" aria-live="polite">{providerName(selectedProvider)} · Profile: {selectedProfile} · {providerState}</p>
    {selectedProvider==='codex'&&selectedProfile==='yolo'&&<p className="shrink-0 px-3 py-1 text-xs">YOLO bypasses native Codex approval/sandbox prompts. BugHunter Scope authorization and methodology confirmation gates still apply.</p>}
    {selectedProvider === 'claude' && <p className="shrink-0 px-3 py-1 text-xs" title={providerState}>Claude: passive Research and existing Burp observations · login is separate for each target · /login · /model · Ctrl+C to interrupt · /exit to stop. Active security skills are unavailable.</p>}
    {error && <p role="alert" className="shrink-0 bg-red-950 px-3 py-2 text-sm">{error}</p>}
    <ResearchReconContext targetId={targetId} provider={selectedProvider} connected={state === 'connected'} />
    <div ref={element} aria-label={`${providerName(selectedProvider)} console for ${host}`} className="min-h-0 flex-1 p-2" />
  </div>;
}
