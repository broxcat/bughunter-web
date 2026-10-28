"use client";
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import '@xterm/xterm/css/xterm.css';

export default function ResearchTerminal({ targetId, company, host, requiredUserAgent, embedded = false }: { targetId: string; company: string; host: string; requiredUserAgent: string; embedded?: boolean }) {
  const element = useRef<HTMLDivElement>(null);
  const [attempt, reconnect] = useState(0), [state, setState] = useState('connecting'), [burp, setBurp] = useState('not checked'), [codex, setCodex] = useState('checking'), [error, setError] = useState('');
  useEffect(() => {
    let disposed = false, ws: WebSocket | undefined, terminal: import('@xterm/xterm').Terminal | undefined, observer: ResizeObserver | undefined;
    let renewal: ReturnType<typeof setInterval> | undefined;
    const connect = async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]);
      if (disposed || !element.current) return;
      terminal = new Terminal({ cursorBlink: true, scrollback: 3000, fontSize: 14, fontFamily: getComputedStyle(element.current).getPropertyValue('--font-jetbrains-mono').trim() || 'monospace', theme: { background: '#090d12', foreground: '#d9e2ef' }, allowProposedApi: false });
      const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(element.current); fit.fit(); terminal.focus();
      setError(''); setState('connecting');
      const ticket = async () => {
        const r = await fetch(`/api/research-targets/${targetId}/terminal`, { method: 'POST', cache: 'no-store' });
        const data = await r.json(); if (!r.ok) throw new Error(data.error ?? 'Console unavailable'); return data;
      };
      const signed = await ticket(); if (disposed) return;
      const url = new URL(`/research-terminal/${targetId}`, window.location.origin); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(url, ['bh-terminal.v1', `ticket.${signed.token}`]);
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
        if (message.type === 'ready') setState('connected');
        if (message.type === 'output') terminal?.write(message.data);
        if (message.type === 'status') { setBurp(message.burp); setCodex(message.codex); }
        if (message.type === 'error') setError(message.code);
      };
      ws.onclose = () => { if (renewal) clearInterval(renewal); if (!disposed) setState('disconnected'); };
      ws.onerror = () => { if (!disposed) setError('Terminal connection unavailable. Reconnect when the Research console is ready.'); };
    };
    void connect().catch(e => { if (!disposed) { setError(e.message); setState('unavailable'); } });
    return () => { disposed = true; if (renewal) clearInterval(renewal); observer?.disconnect(); ws?.close(); terminal?.dispose(); };
  }, [targetId, attempt]);
  return <div className={`flex ${embedded ? "h-[650px] rounded border border-border" : "h-dvh"} w-full flex-col overflow-hidden bg-[#090d12] text-slate-200`}>
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-800 px-3 py-2 text-xs">
      <Link className="text-slate-400 hover:text-white" href="/research">← Research</Link>
      <h1 className="mr-auto truncate text-sm font-medium">{company} / {host}</h1>
      <span className="max-w-48 truncate" title={requiredUserAgent}>UA: {requiredUserAgent}</span><span aria-live="polite">Terminal: {state}</span><span>Codex: {codex}</span><span>Burp MCP: {burp}</span>
      <button className="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800" onClick={() => reconnect(n => n + 1)}>Reconnect</button>
    </header>
    {error && <p role="alert" className="shrink-0 bg-red-950 px-3 py-2 text-sm">{error}</p>}
    <div ref={element} aria-label={`Codex console for ${host}`} className="min-h-0 flex-1 p-2" />
  </div>;
}
