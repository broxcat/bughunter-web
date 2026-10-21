// Business Logic — sequence / workflow-bypass scanner (web2-vuln-classes SKILL).
//
// INTRINSICALLY LOWER DETECTION RATE — BY DESIGN, NOT A BUG. Real business-logic
// flaws depend on domain knowledge a generic scanner does not have (what a flow
// is *supposed* to enforce, which value the server should compute, what counts as
// "once"). This family therefore finds far less than the injection families, and
// that is expected and correct. We would rather report nothing than invent a
// business rule the app never promised.
//
// This scanner looks for a multi-step flow in the authenticated crawl (a numbered
// step sequence, or a known funnel like cart→checkout→confirm) and then, from a
// FRESH / ISOLATED session that never walked the flow, calls the FINAL step
// directly — skipping the intermediate steps the normal crawl went through — to
// see whether the server lets the final action happen out of order.
//
// STRICT EPISTEMIC HONESTY (the strictest in the port):
//   - A 200 on the directly-called final step PROVES NOTHING: it may just render
//     a page, redirect back into the real flow, or no-op server-side.
//   - PROVEN (HIGH) requires a VERIFIED second-order side effect: a newly created
//     resource id that an independent control read confirms appeared — produced
//     despite the mandatory intermediate step NOT having run in this session.
//   - Everything weaker is CANDIDATE (MEDIUM) with a precise reason. If even the
//     sequence detection is uncertain, we record nothing.
//
// SAFETY: we probe the final step with a safe, idempotent GET only. We never fire
// blind state-changing POSTs (which could place a real order / trigger a real
// charge) and never touch destructive/payment finals — reversibility first. This
// further lowers detection on POST-only confirms, which is an accepted trade-off
// for not causing side effects on an authorized target.

import type { ScanContext } from "./context";
import { logLine, recordFinding } from "./context";
import { probe, type ProbeResult } from "./http";
import { discoverCorpus } from "./discovery";
import { isLikelyUserParam } from "./paramFilter";
import { loadTargetCredentials, credentialHeaders } from "@/server/credentials";

const MAX_WORKFLOWS = 5;
const PROBE_TIMEOUT = 10_000;

// Finals we refuse to touch — irreversible or real-money actions (safety rule).
const DESTRUCTIVE_RE =
  /\b(delete|remove|destroy|wipe|purge|cancel|refund|charge|capture|payout|withdraw)\b/i;
// An action-ish final (relevant for describing the lead; we still only GET it).
const ACTION_RE =
  /(confirm|complete|submit|finali[sz]e|activate|claim|redeem|place[-_]?order|success|thank[-_]?you)/i;
// A freshly created resource identifier in a response body.
const CREATED_ID_RE =
  /"(id|orderId|order_id|orderNumber|confirmationNumber|confirmation|reference|referenceNumber|ticketId|transactionId|bookingId|receiptId)"\s*:\s*"?([A-Za-z0-9][A-Za-z0-9._-]{3,})/i;
// Success/confirmation wording (a weak signal only — never proof on its own).
const SUCCESS_WORD_RE =
  /\b(confirmed|completed|success(?:ful)?|approved|your order|thank you|activated|congratulations)\b/i;
// Endpoints that can serve as an independent control read for second-order proof.
const STATUS_HINT_RE =
  /(\/orders?\b|\/history\b|\/transactions?\b|\/account\b|\/dashboard\b|\/me\b|\/bookings?\b|\/purchases?\b|\/receipts?\b|\/status\b)/i;
// Paths that mean "the flow pushed us back" — so the sequence is actually enforced.
const FLOW_REDIRECT_RE =
  /(\/login\b|\/signin\b|\/sign-in\b|\/cart\b|\/basket\b|\/checkout\b|\/step|\/start\b|\/register\b)/i;

// Known ordered funnels. Each stage is matched against a URL path; the last
// matched stage is the "final step", earlier matched stages are intermediates.
const FUNNELS: ReadonlyArray<{ name: string; stages: RegExp[] }> = [
  {
    name: "cart → checkout → confirm",
    stages: [/\b(cart|basket)\b/i, /\bcheckout\b/i, /\b(confirm|complete|success|place[-_]?order|thank[-_]?you)\b/i],
  },
  {
    name: "register → verify → activate",
    stages: [/\b(register|sign[-_]?up)\b/i, /\b(verify|confirm[-_]?email)\b/i, /\b(activate|welcome)\b/i],
  },
  {
    name: "apply → review → submit",
    stages: [/\b(apply|application)\b/i, /\b(review|summary)\b/i, /\b(submit|finali[sz]e|confirm)\b/i],
  },
];

interface Workflow {
  name: string;
  intermediates: string[];
  final: string;
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/** Known-funnel detection: one workflow per funnel whose final + ≥1 earlier stage appear. */
function detectFunnels(urls: string[]): Workflow[] {
  const out: Workflow[] = [];
  for (const f of FUNNELS) {
    const matched: string[] = [];
    for (const stage of f.stages) {
      const hit = urls.find((u) => stage.test(pathOf(u)) && !matched.includes(u));
      if (hit) matched.push(hit);
    }
    if (matched.length >= 2) {
      out.push({ name: f.name, intermediates: matched.slice(0, -1), final: matched[matched.length - 1] });
    }
  }
  return out;
}

/** Return {base, n} if a URL encodes a step number (path `/stepN` or `?step=N`). */
function stepInfo(url: string): { base: string; n: number } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const pathStep = u.pathname.match(/^(.*?)(?:step[-_/]?)(\d{1,2})\/?$/i);
  if (pathStep) return { base: `${u.origin}${pathStep[1]}#pathstep`, n: Number(pathStep[2]) };
  const q = u.searchParams.get("step");
  if (q && /^\d{1,2}$/.test(q) && isLikelyUserParam(url, "step")) {
    const rest = new URLSearchParams(u.searchParams);
    rest.delete("step");
    return { base: `${u.origin}${u.pathname}?${rest.toString()}#qstep`, n: Number(q) };
  }
  return null;
}

/** Numbered-step detection: group URLs that share a base and differ only by step number. */
function detectNumbered(urls: string[]): Workflow[] {
  const groups = new Map<string, Array<{ n: number; url: string }>>();
  for (const url of urls) {
    const s = stepInfo(url);
    if (!s) continue;
    const arr = groups.get(s.base) ?? [];
    if (!arr.some((e) => e.n === s.n)) arr.push({ n: s.n, url });
    groups.set(s.base, arr);
  }
  const out: Workflow[] = [];
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => a.n - b.n);
    out.push({
      name: `numbered steps (${arr.map((a) => a.n).join("→")})`,
      intermediates: arr.slice(0, -1).map((a) => a.url),
      final: arr[arr.length - 1].url,
    });
  }
  return out;
}

export async function runBusinessLogicWorkflow(ctx: ScanContext): Promise<void> {
  try {
    await logLine(ctx.scanRunId, `[bl-workflow] sequence/workflow-bypass checks on ${ctx.baseUrl}`);

    const corpus = await discoverCorpus(ctx);
    if (!corpus.html) {
      await logLine(ctx.scanRunId, `[bl-workflow] could not crawl ${ctx.baseUrl} — skipping`, "STDERR");
      return;
    }
    if (corpus.authenticated) {
      await logLine(ctx.scanRunId, `[bl-workflow] using authenticated crawl (${corpus.urls.length} URLs)`);
    }

    // Build workflows (funnels + numbered), dedupe by final, drop destructive finals, cap.
    const all = [...detectFunnels(corpus.urls), ...detectNumbered(corpus.urls)];
    const seenFinal = new Set<string>();
    const workflows: Workflow[] = [];
    for (const w of all) {
      if (seenFinal.has(w.final)) continue;
      if (DESTRUCTIVE_RE.test(pathOf(w.final))) {
        await logLine(ctx.scanRunId, `[bl-workflow] skipping destructive final ${pathOf(w.final)} (safety)`);
        continue;
      }
      seenFinal.add(w.final);
      workflows.push(w);
      if (workflows.length >= MAX_WORKFLOWS) break;
    }

    if (workflows.length === 0) {
      await logLine(
        ctx.scanRunId,
        `[bl-workflow] no multi-step flow detected in ${corpus.urls.length} crawled URL(s) — nothing to test ` +
          `(expected on many apps; business-logic coverage is intentionally conservative)`,
      );
      return;
    }
    await logLine(ctx.scanRunId, `[bl-workflow] ${workflows.length} candidate workflow(s) to test`);

    // Fresh / isolated session: prefer a SECOND account that never walked the flow;
    // else anonymous. Never creds[0] — the shared crawl already drove it through.
    let isolated: Record<string, string> = {};
    let sessionNote = "anonymous (no second credential)";
    try {
      const creds = await loadTargetCredentials(ctx.targetId);
      if (creds.length >= 2) {
        isolated = credentialHeaders(creds[1]);
        sessionNote = `isolated account "${creds[1].label}"`;
      }
    } catch {
      /* anonymous */
    }

    // Pick one control-read endpoint from the corpus (for second-order verification).
    const statusUrl = corpus.urls.find((u) => STATUS_HINT_RE.test(pathOf(u)) && !DESTRUCTIVE_RE.test(pathOf(u)));

    for (const wf of workflows) {
      try {
        const finalPath = pathOf(wf.final);
        const skipped = wf.intermediates.map(pathOf).join(", ") || "(none ordered before it)";

        // Baseline control read BEFORE touching the final step.
        const baseline = statusUrl
          ? await probe(statusUrl, { headers: isolated, timeoutMs: PROBE_TIMEOUT })
          : null;

        // Directly GET the final step from the isolated session, skipping intermediates.
        const res: ProbeResult = await probe(wf.final, { headers: isolated, timeoutMs: PROBE_TIMEOUT });

        // Flow enforced? A redirect/location back into the funnel/login, or an
        // auth/not-found/error status, means the sequence held — no finding.
        const loc = res.headers["location"] ?? "";
        const redirectedToFlow = res.status >= 300 && res.status < 400 && FLOW_REDIRECT_RE.test(loc);
        if (redirectedToFlow) {
          await logLine(
            ctx.scanRunId,
            `[bl-workflow] ${finalPath} → ${res.status} redirect into the flow/login — sequence enforced, no finding`,
          );
          continue;
        }
        if (res.error || res.status !== 200) {
          await logLine(
            ctx.scanRunId,
            `[bl-workflow] ${finalPath} → ${res.error ? `error (${res.error})` : res.status} out of order — not reachable, no finding`,
          );
          continue;
        }

        const createdMatch = CREATED_ID_RE.exec(res.body);
        const createdId = createdMatch?.[2] ?? null;
        const successWord = SUCCESS_WORD_RE.test(res.body);

        // Second-order verification: did an independent control read change to
        // include the new resource that the baseline did not have?
        let secondOrderProven = false;
        if (createdId && statusUrl && baseline && !baseline.error) {
          const after = await probe(statusUrl, { headers: isolated, timeoutMs: PROBE_TIMEOUT });
          if (
            !after.error &&
            after.status === 200 &&
            after.body.includes(createdId) &&
            !baseline.body.includes(createdId)
          ) {
            secondOrderProven = true;
          }
        }

        if (secondOrderProven) {
          await recordFinding(ctx, {
            title: `Business-logic workflow bypass: final step reachable out of order (${wf.name})`,
            vulnClass: "Business Logic (Workflow Bypass)",
            severity: "HIGH",
            confidence: "PROVEN",
            location: wf.final,
            description:
              `The final step ${finalPath} was invoked directly from a ${sessionNote} that never ` +
              `executed the preceding step(s) [${skipped}], and it produced a real, independently ` +
              `verified side effect: a new resource id (${createdId}) that appeared in the control ` +
              `read ${pathOf(statusUrl!)} afterward but was absent before. The server does not enforce ` +
              `the required step order.`,
            evidence:
              `Skipped intermediate step(s): ${skipped}\n` +
              `Direct GET ${wf.final} -> HTTP ${res.status}, ${res.bodyLen} bytes` +
              `${successWord ? " (success wording present)" : ""}\n` +
              `Control read ${pathOf(statusUrl!)} now contains new id "${createdId}" (absent in baseline).`,
          });
          await logLine(ctx.scanRunId, `[bl-workflow] PROVEN workflow bypass @ ${finalPath} (${wf.name})`);
          continue;
        }

        // Reachable directly with a plausible success signal, but no verified
        // side effect → honest CANDIDATE. (If there is no success/created signal
        // at all, the 200 is just a reachable page — record nothing, no noise.)
        if (createdId || successWord || ACTION_RE.test(finalPath)) {
          const why = createdId
            ? `the response carried a resource id ("${createdId}") but no independent control read confirmed a new side effect` +
              `${statusUrl ? "" : " (no status/history endpoint was available to verify)"}`
            : successWord
              ? `the response showed success wording but no created resource or control-read change confirmed a real side effect`
              : `the final step is action-shaped and returned 200 directly, but no side effect could be confirmed`;
          await recordFinding(ctx, {
            title: `Possible workflow bypass on ${finalPath} (unconfirmed, ${wf.name})`,
            vulnClass: "Business Logic (Workflow Bypass)",
            severity: "MEDIUM",
            confidence: "CANDIDATE",
            location: wf.final,
            description:
              `From a ${sessionNote} that skipped the preceding step(s) [${skipped}], the final step ` +
              `${finalPath} returned HTTP 200, but ${why}. Not confirmed as a real bypass — a 200 can be a ` +
              `rendered page or a no-op. Verify manually that the out-of-order call actually performs the ` +
              `gated action (create the resource, then re-check state as the victim account).`,
            evidence:
              `Skipped intermediate step(s): ${skipped}\n` +
              `Direct GET ${wf.final} -> HTTP ${res.status}, ${res.bodyLen} bytes` +
              `${createdId ? `, resource-id signal "${createdId}"` : ""}${successWord ? ", success wording" : ""}.` +
              `${statusUrl ? `\nControl endpoint available: ${pathOf(statusUrl)} (no confirmed change).` : "\nNo control endpoint found for second-order verification."}`,
          });
          await logLine(ctx.scanRunId, `[bl-workflow] candidate (unconfirmed) @ ${finalPath} (${wf.name})`);
        } else {
          await logLine(
            ctx.scanRunId,
            `[bl-workflow] ${finalPath} → 200 but no success/created signal — likely a reachable page, no finding`,
          );
        }
      } catch (err) {
        await logLine(
          ctx.scanRunId,
          `[bl-workflow] workflow "${wf.name}" errored: ${err instanceof Error ? err.message : String(err)}`,
          "STDERR",
        );
      }
    }

    await logLine(ctx.scanRunId, "[bl-workflow] done");
  } catch (err) {
    await logLine(
      ctx.scanRunId,
      `[bl-workflow] errored: ${err instanceof Error ? err.message : String(err)}`,
      "STDERR",
    );
  }
}
