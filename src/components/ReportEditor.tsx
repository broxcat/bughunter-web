"use client";
import {platformLabel} from '@/lib/platformPresentation';
import {lifecycleReportEligible} from '@/lib/findingLifecycle';
import EvidencePanel from '@/components/EvidencePanel';
import { findingReviewStatus } from "@/lib/evidenceReview";

import Link from "next/link";
import {useRouter,useSearchParams} from 'next/navigation';
import CollectionPager from './CollectionPager';
import {paginationInput} from '@/lib/pagination';
import { Suspense,useEffect, useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";


type Platform =
  | "HACKERONE"
  | "BUGCROWD"
  | "INTIGRITI"
  | "YESWEHACK"
  | "IMMUNEFI"
  | "GENERIC";

interface Finding {
  id: string;
  title: string;
  severity: string;
  gateStatus?: string;
  reviewStatus?: string;
  lifecycle?:string|null;
  lifecycleEvents?:Array<{id:string}>;
  targetId?:string;
}

const PLATFORMS: Platform[] = [
  "HACKERONE",
  "BUGCROWD",
  "INTIGRITI",
  "YESWEHACK",
  "IMMUNEFI",
  "GENERIC",
];

export default function ReportEditor(props:{id:string;programMode?:boolean}){return <Suspense fallback={<p role="status">Loading report…</p>}><ReportCollection {...props}/></Suspense>;}
function ReportCollection({id,programMode=false}:{id:string;programMode?:boolean}) {
  const router=useRouter(),params=useSearchParams(),query=params.toString();
  const findingInput=paginationInput(new URLSearchParams({page:params.get('findingPage')??'1',pageSize:params.get('pageSize')??'25'}),false);
  const reportInput=paginationInput(new URLSearchParams({page:params.get('reportPage')??'1',pageSize:params.get('pageSize')??'25'}),false);
  type Bounds={page:number;pages:number;total:number};
  const [pages,setPages]=useState<{findings:Bounds;reports:Bounds}|null>(null);
  const [revision,setRevision]=useState(0);
  const [reports, setReports] = useState<{ id: string; title: string; markdown: string; evidenceTargetIds?:string[];targetId?:string|null }[]>([]);
  const [reportId, setReportId] = useState("");
  const [passed, setPassed] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState<Platform>("HACKERONE");
  const [selected, setSelected] = useState<Record<string, Finding>>({});
  const [generating, setGenerating] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const identity=`${programMode?'programId':'targetId'}=${encodeURIComponent(id)}`;
    Promise.all([fetch(`/api/findings?${identity}&page=${findingInput.page}&pageSize=${findingInput.pageSize}`,{signal:controller.signal}),fetch(`/api/reports?${identity}&page=${reportInput.page}&pageSize=${reportInput.pageSize}`,{signal:controller.signal})]).then(async([fr,rr])=>{
      if(!fr.ok||!rr.ok)throw new Error('Unable to load findings and report history');
      const [findings,saved]=await Promise.all([fr.json(),rr.json()]);if(controller.signal.aborted)return;
      setPassed(findings.items.filter((f:Finding)=>findingReviewStatus(f)==='CONFIRMED'&&lifecycleReportEligible(f.lifecycle)&&(f.lifecycle==null||Boolean(f.lifecycleEvents?.length))));
      setReports(saved.items);setReportId(saved.items[0]?.id??'');setMarkdown(saved.items[0]?.markdown??null);setPages({findings,reports:saved});setError(null);
      const next=new URLSearchParams(query);let changed=false;
      for(const [key,page] of [['findingPage',findings.page],['reportPage',saved.page]] as const){if(next.has(key)&&next.get(key)!==String(page)){next.set(key,String(page));changed=true;}}
      if(changed)router.replace('/targets/'+id+'/report?'+next);
    }).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return () => controller.abort();
  }, [id,programMode,query,findingInput.page,findingInput.pageSize,reportInput.page,reportInput.pageSize,router,revision]);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    const chosen=Object.values(selected),findingIds=chosen.map(f=>f.id);
    if (findingIds.length === 0) {
      setError("Select at least one confirmed finding.");
      return;
    }
    if(findingIds.length>100){setError('Select at most 100 Findings per report.');return;}
    setGenerating(true);
    setError(null);
    setMarkdown(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, platform, findingIds }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Failed to generate report (${res.status})`);
      }
      const report = await res.json();
      report.evidenceTargetIds=[...new Set(chosen.map(f=>f.targetId??id))];
      setMarkdown(report.markdown ?? "");
      setReportId(report.id);setReports(previous=>[report,...previous]);setRevision(n=>n+1);const next=new URLSearchParams(query);next.set('reportPage','1');router.replace('/targets/'+id+'/report?'+next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate report");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={programMode?`/targets/${id}`:`/hosts/${id}`}
          className="text-sm text-muted hover:text-foreground"
        >
          ← Target
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          Report
        </h1>
        <p className="mt-1 text-sm text-muted">
          Only confirmed findings can be included.
        </p>
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

      <details className="ui-disclosure" open={!reports.length}><summary>Generate report</summary><div className="mt-4">
        <form onSubmit={generate} className="grid gap-3">
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Report title"
            placeholder="Report title"
            className="rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-subtle"
          />
          <select
            aria-label="Report platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as Platform)}
            className="rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-foreground"
          >
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {platformLabel(p)}
              </option>
            ))}
          </select>

          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Confirmed findings · {Object.keys(selected).length} selected</p>
            {pages&&<CollectionPager path={'/targets/'+id+'/report'} query={query} {...pages.findings} pageKey="findingPage" label="Report finding pages" noun="Findings reviewed for eligibility"/>}
            <p className="text-sm text-muted">Selections are retained across pages. Eligibility is checked on generation.</p>
            {loading ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : passed.length === 0 ? (
              <p className="text-sm text-muted">
                No confirmed findings yet.
              </p>
            ) : (
              passed.map((f) => (
                <label
                  key={f.id}
                  className="flex items-center gap-2 text-sm text-foreground"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(selected[f.id])}
                    onChange={(e) =>
                      setSelected(s=>{const next={...s};if(e.target.checked)next[f.id]=f;else delete next[f.id];return next;})
                    }
                    className="accent-brand"
                  />
                  <span>{f.title}</span>
                  <Badge tone={f.severity.toLowerCase() as BadgeTone}>
                    {f.severity}
                  </Badge>
                </label>
              ))
            )}
          </div>

          <div>
            <Button
              type="submit"
              variant="primary"
              disabled={generating || Object.keys(selected).length === 0}
            >
              {generating ? "Generating…" : "Generate report"}
            </Button>
          </div>
        </form>
      </div></details>

      {pages&&<CollectionPager path={'/targets/'+id+'/report'} query={query} {...pages.reports} pageKey="reportPage" label="Saved report pages"/>}
      {reports.length > 0 && <label className="block text-sm">Saved report<select aria-label="Saved report" className="mt-2 block w-full rounded border border-border bg-surface p-2" value={reportId} onChange={e => { setReportId(e.target.value); setMarkdown(reports.find(r => r.id === e.target.value)?.markdown ?? null); }}>{reports.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></label>}
      <details className="ui-disclosure"><summary>Evidence</summary><div className="mt-4">{reportId&&(reports.find(r=>r.id===reportId)?.evidenceTargetIds??[reports.find(r=>r.id===reportId)?.targetId??id]).map(targetId=><EvidencePanel key={reportId+targetId} targetId={targetId} reportId={reportId}/>)}
      </div></details>
      {markdown !== null && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-foreground">
            Report content
          </h2>
          <section className="overflow-x-auto border-t border-border py-4">
            <pre className="whitespace-pre-wrap font-mono text-sm text-foreground">
              {markdown}
            </pre>
          </section>
        </div>
      )}
    </div>
  );
}
