import type { HuntTechniqueDescriptor } from "@/lib/hunt/catalog";
import type { HuntObservation } from "@/lib/hunt/report";
import type { TechniqueContext } from "./runtime";
import { assessPairedTiming, bodyHash } from "./evidence";
import { credentialHeaders } from "@/server/credentials";
import { payloadVariant } from "@/lib/hunt/payloads";

/** No arbitrary statements/commands: two constants, 1s screening and 2s repeat. */
export async function executeBoundedTiming(t: HuntTechniqueDescriptor, c: TechniqueContext): Promise<HuntObservation[]> {
  const command = t.family === "command-injection";
  const input = c.corpus.queryInputs.find(p => command ? /^(host|domain|file|path|ip|target)$/i.test(p.key) && /^[A-Za-z0-9._/-]{1,80}$/.test(p.value) : /^\d{1,12}$/.test(p.value));
  if (!input) return [];
  const confirmation = t.id.endsWith("confirm");
  const cacheKey = `timing:${t.family}:${input.url}:${input.key}`;
  const first = c.cache.get(cacheKey) as { baselines: number[]; probes: number[] } | undefined;
  if (confirmation && !first) return [];
  const delay = confirmation ? 2 : 1;
  const baselines: number[] = [], probes: number[] = [];
  const headers = c.credentials[0] ? credentialHeaders(c.credentials[0]) : {};
  const payload = (seconds: number) => payloadVariant(command ? "cmd.delay" : "sql.delay").build(input.value, String(seconds));
  const url = (seconds: number) => { const u = new URL(input.url); u.searchParams.set(input.key, payload(seconds)); return u.toString(); };
  for (let i = 0; i < 3; i++) {
    const baseline = await c.request(url(0), { headers });
    const probe = await c.request(url(delay), { headers });
    if (baseline.error || probe.error || baseline.status !== probe.status || bodyHash(baseline.body) !== bodyHash(probe.body)) return [];
    baselines.push(baseline.ms); probes.push(probe.ms);
  }
  if (!confirmation) {
    c.cache.set(cacheKey, { baselines, probes });
    return probes.every((v, i) => v - baselines[i] >= 800) ? [{ title: "Bounded timing candidate", summary: "Three interleaved 1-second probes differ from matched zero-delay controls; a separate larger-delay confirmation is still required.", location: input.url, evidenceLevel: "CANDIDATE", controls: ["THREE_INTERLEAVED_CONTROL_PAIRS"], evidence: { baselineMeanMs: Math.round(baselines.reduce((a, b) => a + b) / 3), probeMeanMs: Math.round(probes.reduce((a, b) => a + b) / 3) } }] : [];
  }
  if (!assessPairedTiming(first!.baselines, first!.probes, baselines, probes, 1000, 2000)) return [];
  return [{ title: command ? "Confirmed bounded command timing differential" : "Confirmed bounded SQL timing differential", summary: "Explicitly approved, fixed 1/2-second delays tracked across two independent three-pair measurements with jitter and content controls. No extraction, arbitrary command, persistent process or state mutation performed.", location: input.url, evidenceLevel: "CONFIRMED", severity: "HIGH", controls: ["EXPLICIT_BOUNDED_TIMING_APPROVAL", "THREE_INTERLEAVED_BASELINE_PAIRS", "INDEPENDENT_LARGER_DELAY", "JITTER_DISTRIBUTION_CONTROL", "MATCHED_RESPONSE_CONTENT"], evidence: { firstDeltaMs: Math.round(first!.probes.reduce((s, v, i) => s + v - first!.baselines[i], 0) / 3), confirmationDeltaMs: Math.round(probes.reduce((s, v, i) => s + v - baselines[i], 0) / 3) } }];
}
