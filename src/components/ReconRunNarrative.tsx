import type { RunNarrative } from '@/lib/reconRunNarrative';
import { EvidenceRefs } from './ReconReportEvidence';
export default function ReconRunNarrative({narrative}:{narrative:RunNarrative}) {
 return <section aria-label="Optional AI synthesis" className="space-y-2">
  <h3 className="font-semibold">Optional AI synthesis</h3>
  <p role="status" className="text-sm text-muted">{narrative.state==='AI_ASSISTED'?'AI-assisted evidence highlights':narrative.state==='PENDING'?'Optional synthesis pending. Deterministic fallback remains complete.':narrative.state==='UNAVAILABLE'?'AI synthesis unavailable. Deterministic fallback remains complete.':'Deterministic fallback. No stored validated synthesis for this run.'}</p>
  {narrative.state==='AI_ASSISTED'&&<><p className="text-xs text-muted">{narrative.provider} · {narrative.model}. AI selects evidence; application-written facts remain authoritative.</p><ul className="space-y-2 text-sm">{narrative.highlights.map((row,i)=><li key={i} className="break-all">{row.text}<EvidenceRefs refs={row.refs}/></li>)}</ul></>}
  <p className="text-xs text-muted">Optional synthesis uses the existing default-provider workflow in Target Summary and Settings. Viewing or refreshing this report never generates AI content.</p>
 </section>;
}
