import { researchDataSchema, researchObservations } from "@/lib/research/hypotheses";
export default function ResearchProof({ value, compact = false }: { value: unknown; compact?: boolean }) {
  const parsed = researchDataSchema.safeParse(value);
  if (!parsed.success) return <p>Legacy v1 research snapshot — structured reproduction/controls unavailable. No proof was inferred.</p>;
  const d = parsed.data, latest = researchObservations(d).sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt)).slice(0, compact ? 1 : 5);
  return <section className="space-y-3" aria-label="Structured research proof">
    <p>{d.host} · {d.location ?? "No observed endpoint supplied"} · Suspected family: {d.suspectedVulnClass ?? "Unknown"}</p>
    {!compact && <p>Research source created: {d.createdAt}</p>}
    <p>Evidence quality (research claim): {d.tests.length ? [...new Set(d.tests.map(t => t.evidenceQuality))].join(", ") : "OBSERVATION"}</p>
    <h3 className="font-semibold">Latest observations</h3>{latest.map(o => <div key={o.id}><p>{o.id} · {o.source} · {o.observedAt} · {o.host}</p><p>{o.summary}</p>{!compact && o.evidence.map((e, i) => <p key={i}><code>{e.ref}</code> — {e.summary}</p>)}</div>)}
    {!compact && <>
      <h3 className="font-semibold">Reasoning and prerequisites</h3><p>{d.reasoning}</p><ul>{d.prerequisites.map((p, i) => <li key={i}>{p}</li>)}</ul>
      <p>Suspected impact (not demonstrated severity): {d.suspectedImpact}</p><p>Suggested severity: {d.suggestedSeverity ?? "None"} — never applied automatically.</p>
      <h3 className="font-semibold">Performed tests and negative controls</h3>
      {d.tests.map(t => <details key={t.id} open><summary>{t.id} · {t.outcome} · {t.evidenceQuality} · {t.performedAt}</summary><p>Rationale: {t.rationale}</p><p>Procedure: {t.procedure}</p><p>Expected signal: {t.expectedSignal}</p><p>Falsification: {t.falsificationCondition}</p><ol>{t.reproductionSteps.map((s, i) => <li key={i}>{s}</li>)}</ol><p>Reproducibility: {t.reproducibility}</p><p>Security effect: {t.securityEffect}</p>{t.observations.map(o => <div key={o.id}><p>{o.id} · {o.source} · {o.host}: {o.summary}</p>{o.evidence.map((e, i) => <p key={i}><code>{e.ref}</code> — {e.summary}</p>)}</div>)}<p>Negative control: {t.negativeControl.kind}</p>{t.negativeControl.kind === "PERFORMED" ? <><p>{t.negativeControl.procedure}</p><p>{t.negativeControl.significance}</p>{t.negativeControl.observations.map(o => <div key={o.id}><p>{o.id} · {o.source} · {o.host}: {o.summary}</p>{o.evidence.map((e, i) => <p key={i}><code>{e.ref}</code> — {e.summary}</p>)}</div>)}</> : <p>{t.negativeControl.reason}</p>}<p>Conclusion: {t.conclusion}</p></details>)}
      <p>Conclusion: {d.conclusion ?? "Pending tests"}</p><p>Why the next test is distinct: {d.nextTestRationale}</p>
    </>}
  </section>;
}
