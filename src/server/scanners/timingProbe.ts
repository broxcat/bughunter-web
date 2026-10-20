// Shared time-based measurement helper for the vuln-class scanners.
//
// EPISTEMIC HONESTY is the whole point of this module. A single slow response
// proves nothing — networks jitter, a cold backend stalls, a GC pause lands. So
// `delayObserved` is set only when the injected-payload mean clears the baseline
// by BOTH a multiple of the baseline's own variance (3σ) AND a hard 2s floor.
// Even that is only a one-value signal: the CALLER must reproduce it with a
// second, different injected delay before concluding anything (see sqli.ts).
//
// It NEVER throws: `probe` already folds network errors into status 0 with an
// `error` field, and a failed request during measurement invalidates the timing
// conclusion, so we bail out returning `delayObserved: false` with whatever
// partial samples we had gathered — a measurement error is never a delay.

import { probe } from "./http";

export interface TimingResult {
  delayObserved: boolean;
  meanDelayMs: number; // mean of the injected-payload samples
  baselineMeanMs: number;
  baselineStdDevMs: number;
  samples: number[]; // injected-payload per-request timings (ms)
}

// The literal token substituted in the url template for each request.
const PAYLOAD_TOKEN = "__PAYLOAD__";
const DEFAULT_SAMPLES = 3;
// Comfortably above the max injected sleep (scanners cap at 5s) so a real
// backend delay is measured rather than clipped by an abort.
const PROBE_TIMEOUT_MS = 15_000;
// Hard floor the injected mean must clear on top of the 3σ test: a backend may
// be near-deterministic (σ≈0), so without this a few ms of jitter could trip a
// pure 3σ comparison. 2s matches the smallest sleep scanners inject (N≥3s).
const MIN_DELTA_MS = 2000;

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Population standard deviation. */
function stdDev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  const variance = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length;
  return Math.sqrt(variance);
}

/** Substitute the URL-encoded payload into every __PAYLOAD__ token. */
function buildUrl(template: string, payload: string): string {
  return template.split(PAYLOAD_TOKEN).join(encodeURIComponent(payload));
}

/**
 * Measure whether `injectPayload` makes the server respond measurably slower
 * than `baselinePayload`, both substituted into the `__PAYLOAD__` token of
 * `url`. Sends `sampleCount` baseline requests first, then `sampleCount` inject
 * requests. See the module header for the (deliberately strict) delay rule.
 *
 * Never throws. A network error on any request aborts measurement and returns
 * `delayObserved: false` with the partial inject samples gathered so far.
 */
export async function measureTimingDelta(
  url: string,
  injectPayload: string,
  baselinePayload: string,
  sampleCount: number = DEFAULT_SAMPLES,
): Promise<TimingResult> {
  const n = Math.max(1, Math.floor(sampleCount));
  const baselineSamples: number[] = [];
  const samples: number[] = [];

  const fail = (): TimingResult => ({
    delayObserved: false,
    meanDelayMs: mean(samples),
    baselineMeanMs: mean(baselineSamples),
    baselineStdDevMs: stdDev(baselineSamples),
    samples,
  });

  try {
    // Baseline first — establishes the natural response time + its variance.
    for (let i = 0; i < n; i += 1) {
      const res = await probe(buildUrl(url, baselinePayload), {
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      if (res.error) return fail();
      baselineSamples.push(res.ms);
    }

    // Injected payload — the samples we test against the baseline.
    for (let i = 0; i < n; i += 1) {
      const res = await probe(buildUrl(url, injectPayload), {
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      if (res.error) return fail();
      samples.push(res.ms);
    }
  } catch {
    // probe is already non-throwing; this is belt-and-suspenders so the helper
    // can NEVER throw regardless of future changes to probe.
    return fail();
  }

  const baselineMeanMs = mean(baselineSamples);
  const baselineStdDevMs = stdDev(baselineSamples);
  const meanDelayMs = mean(samples);

  const delayObserved =
    meanDelayMs > baselineMeanMs + 3 * baselineStdDevMs &&
    meanDelayMs > baselineMeanMs + MIN_DELTA_MS;

  return { delayObserved, meanDelayMs, baselineMeanMs, baselineStdDevMs, samples };
}
