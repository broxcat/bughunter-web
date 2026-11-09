"use client";

import Link from "next/link";
import {useRouter,useSearchParams} from "next/navigation";
import {paginationInput} from "@/lib/pagination";
import CollectionPager from "@/components/CollectionPager";
import TargetAuthentication from "@/components/TargetAuthentication";
import CreateResearchButton from "@/components/CreateResearchButton";
import { Suspense, use, useEffect, useState } from "react";
import ScanCancelButton from "@/components/ScanCancelButton";
import ScanLogViewer from "@/components/ScanLogViewer";
import {
  ScopePolicyView,
  hasPolicy,
  type ScopePolicyData,
} from "@/components/ScopePolicy";
import { scanPresentation } from "@/lib/scanPresentation";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";

type ScanType = "RECON" | "HUNT" | "VALIDATE";

interface ScanRun {
  id: string;
  type: ScanType;
  status: string;
  outcome: string | null;
  cancelRequestedAt?: string | null;
  execution?: { state: string } | null;
  dispatch?: string | null;
  requiredUserAgent: string | null;
  createdAt: string;
}

interface Scope extends ScopePolicyData {
  id: string;
  hostPattern: string;
  status: string;
}

interface TargetDetail {
  scanRejection: string | null;
  program: { id: string; companyName: string; requiredUserAgent: string } | null;
  id: string;
  host: string;
  label: string | null;
  scope: Scope;
  scanRuns: ScanRun[];
  findingCount:number;
  scanPage:{page:number;pages:number;total:number;pageSize:number};
}

export default function TargetDetailPage(props:{params:Promise<{id:string}>}){const {id}=use(props.params);return <Suspense fallback={<p role="status">Loading host…</p>}><TargetDetailContent key={id} {...props}/></Suspense>;}
function TargetDetailContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router=useRouter(),paramsQuery=useSearchParams(),query=paramsQuery.toString();
  const input=paginationInput(new URLSearchParams({page:paramsQuery.get("scanPage")??"1",pageSize:paramsQuery.get("pageSize")??"25"}),false);
  const endpoint=`/api/targets/${id}?scanPage=${input.page}&pageSize=${input.pageSize}`;

  const [loadedEndpoint,setLoadedEndpoint]=useState('');
  const [target, setTarget] = useState<TargetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(`Failed to load target (${res.status})`);
      setTarget(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load target");
    } finally {
      setLoading(false);
    }
  }

  useEffect(()=>{const c=new AbortController();
    fetch(endpoint,{signal:c.signal}).then(async r=>{
      if(!r.ok)throw new Error('Host not found');const body=await r.json();if(c.signal.aborted)return;setTarget(body);setError(null);setLoadedEndpoint(endpoint);
      const current=new URLSearchParams(window.location.search);if(current.has('scanPage')&&current.get('scanPage')!==String(body.scanPage.page)){current.set('scanPage',String(body.scanPage.page));router.replace(`/hosts/${id}?`+current);}
    }).catch(e=>{if(!c.signal.aborted){setTarget(null);setError(e.message);setLoadedEndpoint(endpoint);}}).finally(()=>{if(!c.signal.aborted)setLoading(false);});return()=>c.abort();
  },[id,endpoint,router]);


  if (loading||loadedEndpoint!==endpoint) return <p className="text-sm text-muted">Loading…</p>;
  if (error && !target)
    return (
      <div
        role="alert"
        className="flex items-center gap-2 rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-sm text-foreground"
      >
        <Badge tone="critical">Error</Badge>
        <span>{error}</span>
      </div>
    );
  if (!target) return <p className="text-sm text-muted">Not found.</p>;

  const scopeApproved = !target.scanRejection;

  return (
    <div className="space-y-8">
      <div>
        <Link href={target.program ? `/scopes?target=${target.program.id}` : "/scopes"} className="text-sm text-muted hover:text-foreground">
          ← Scope
        </Link>
        <h1 className="mt-2 font-mono text-2xl font-semibold tracking-tight text-foreground">
          {target.program?.companyName && <span className="block text-sm font-sans">{target.program.companyName}</span>}{target.host}
        </h1>
        {target.label && <p className="text-sm text-muted">{target.label}</p>}
        <p className="mt-1 text-sm text-muted">{scopeApproved ? target.host.startsWith("*.") ? "Scope rule — passive program Recon available" : "Active scope host" : "History — unavailable for new scans"}</p>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-sm text-foreground"
        >
          <Badge tone="critical">Error</Badge>
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {target.program && <Link className="text-brand" href={`/targets/${target.program.id}?tab=Recon`}>Recon from target assets →</Link>}
        {scopeApproved && target.host.startsWith("*.") && target.program ? <Link className="text-brand" href={`/targets/${target.program.id}?tab=Codex%20Console`}>Open program Codex console</Link> : <CreateResearchButton targetId={id} disabled={!scopeApproved} />}
        <div className="ml-auto flex gap-4 text-sm">
          <Link
            href={`/targets/${id}/findings`}
            className="text-brand hover:text-brand-hover"
          >
            Findings ({target.findingCount})
          </Link>
          <Link
            href={`/targets/${id}/report`}
            className="text-brand hover:text-brand-hover"
          >
            Report
          </Link>
        </div>
      </div>

      {!scopeApproved && (
        <p className="text-sm text-muted">
          {target.scanRejection}
        </p>
      )}

      {target.program && <p className="text-sm">Required User-Agent: <code>{target.program.requiredUserAgent}</code></p>}
      {/* Program policy reminder — informational only; scan authorization is
          decided by the scope status above, never by this text. */}
      {hasPolicy(target.scope) && (
        <details
          open={Boolean(
            target.scope.outOfScope?.trim() ||
              target.scope.rulesOfEngagement?.trim(),
          )}
          className="rounded-md border border-border bg-surface-2 px-4 py-3"
        >
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            Program policy{" "}
            <span className="font-normal text-subtle">
              — review out of scope and rules of engagement before testing
            </span>
          </summary>
          <div className="mt-3">
            <ScopePolicyView policy={target.scope} emphasisFirst />
          </div>
        </details>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">Scan runs</h2>
        <CollectionPager path={`/hosts/${id}`} query={query} {...target.scanPage} pageKey="scanPage" label="Host history pages" noun="scan runs"/>
        {target.scanRuns.length === 0 ? (
          <p className="text-sm text-muted">No scan runs yet.</p>
        ) : (
          <ul className="space-y-2">
            {target.scanRuns.map((run) => (
              <li key={run.id}>
                <Card className="overflow-hidden">
                  <div className="flex flex-wrap items-center gap-3 p-4"><button
                    aria-expanded={openRun === run.id}
                    aria-controls={openRun === run.id ? `logs-${run.id}` : undefined}
                    onClick={() =>
                      setOpenRun((cur) => (cur === run.id ? null : run.id))
                    }
                    className="flex min-w-0 flex-1 items-center justify-between gap-4 rounded p-2 text-left hover:bg-surface-2"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-foreground">
                        {run.type === "HUNT" ? "Legacy hunt" : run.type}
                      </span>
                      <Badge tone={scanPresentation(run.status, run.outcome, run.dispatch, run.execution?.state, Boolean(run.cancelRequestedAt)).tone}>
                        {scanPresentation(run.status, run.outcome, run.dispatch, run.execution?.state, Boolean(run.cancelRequestedAt)).label}
                      </Badge>
                      {run.execution?.state === "INTERRUPTED" && <span className="text-sm text-muted">Automatic retry disabled.</span>}
                    </div>
                    <span className="text-xs text-subtle">
                      {openRun === run.id ? "Hide logs" : "View live logs"}
                    </span>
                  </button>
                  {run.type === 'HUNT' && <Link href={`/hunt/${run.id}`} className="text-brand">View hunt history</Link>}
                  {run.type === "RECON" && <ScanCancelButton scanRunId={run.id} status={run.status} requested={Boolean(run.cancelRequestedAt)} onRequested={() => void load()} />}
                  </div>
                  {openRun === run.id && (
                    <div id={`logs-${run.id}`} className="border-t border-border p-4">
                      {run.requiredUserAgent && <p>User-Agent used: <code>{run.requiredUserAgent}</code></p>}
                      <ScanLogViewer scanRunId={run.id} showReconSummary={run.type === "RECON"} />
                    </div>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <TargetAuthentication targetId={id} disabled={!scopeApproved || target.host.startsWith("*.")} />
    </div>
  );
}
