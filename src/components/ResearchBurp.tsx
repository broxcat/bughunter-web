"use client";
import { useState } from "react";
import type { BurpDiagnostic } from "@/lib/research/burp";
import { Card } from "./ui/Card";
export default function ResearchBurp({ sessionId, workspaceId, port }: { sessionId: string; workspaceId: string; port: string }) {
  const [diagnostic, setDiagnostic] = useState<BurpDiagnostic | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function refresh() {
    setBusy(true); setError(false);
    try {
      const res = await fetch(`/api/research-sessions/${sessionId}/burp`, { signal: AbortSignal.timeout(4000), cache: "no-store" });
      if (!res.ok) throw new Error();
      setDiagnostic((await res.json()).diagnostic);
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  return <Card className="p-5 space-y-3"><h2 className="text-xl">Burp MCP (optional)</h2>
    <p>Workspace: <code>{workspaceId}</code></p>
    <p>Burp MCP: {diagnostic?.configuration === "CONFIGURED" ? "configured" : "unavailable / not checked"}</p>
    {diagnostic && <p>Last runner diagnostic: {diagnostic.runner}; Burp {diagnostic.upstream.toLowerCase()} at {diagnostic.checkedAt}</p>}
    <p className="text-sm text-muted">A workspace diagnostic expires after five minutes. It is operator-produced data, not a live web connectivity check.</p>
    <button type="button" disabled={busy} onClick={refresh} className="text-brand">{busy ? "Reading diagnostic…" : "Refresh last diagnostic"}</button>
    {error && <p role="alert">Diagnostic unavailable. Research and other BugHunter features remain available.</p>}
    <p>Run Burp Suite with PortSwigger MCP Server 1.3.0 on the Docker host at 127.0.0.1:9876. Configure exact scope, exclusions and required User-Agent in Burp. In a separate host terminal, keep this restricted tunnel open:</p>
    <pre className="overflow-auto">{`ssh -i ~/.ssh/bughunter_research -p ${port} -N -o ExitOnForwardFailure=yes -R 127.0.0.1:9876:127.0.0.1:9876 researcher@127.0.0.1`}</pre>
    <p>Inside your Research SSH session:</p>
    <pre className="overflow-auto">{`cd /workspaces/${workspaceId}\nbughunter-burp-status\nbughunter-codex`}</pre>
    <p className="text-sm text-muted">Codex receives filtered passive metadata only. No active Burp tools, raw bodies, credentials or automatic Findings. Discovery never grants authorization. The gateway cannot control manual Burp traffic or other shell tools. <a className="text-brand" href="https://github.com/broxcat/bughunter-web/blob/main/docs/BURP-MCP-RESEARCH.md" target="_blank" rel="noreferrer">Setup and limits</a>.</p>
  </Card>;
}
