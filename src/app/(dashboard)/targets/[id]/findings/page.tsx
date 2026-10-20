"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { GATE_QUESTIONS } from "@/lib/gate";

type Severity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type GateStatus = "UNVALIDATED" | "PASSED" | "KILLED";
type Confidence = "CANDIDATE" | "PROVEN";

interface Finding {
  id: string;
  title: string;
  vulnClass: string | null;
  severity: Severity;
  confidence: Confidence | null;
  description: string | null;
  location: string | null;
  evidence: string | null;
  gateStatus: GateStatus;
  killedReason: string | null;
  oobToken?: string | null;
  oobHits?: { receivedAt: string; sourceIp: string | null; method: string }[];
}

const SEVERITIES: Severity[] = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  PROVEN: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  CANDIDATE: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
};

const GATE_STYLE: Record<GateStatus, string> = {
  UNVALIDATED: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  PASSED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  KILLED: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
};

function GateForm({
  findingId,
  onDone,
}: {
  findingId: string;
  onDone: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const full: Record<string, boolean> = {};
      for (const q of GATE_QUESTIONS) full[q.id] = answers[q.id] === true;
      const res = await fetch(`/api/findings/${findingId}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: full }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Validation failed (${res.status})`);
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Validation failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3 space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <p className="text-xs font-medium text-zinc-500">7-Question Gate</p>
      {GATE_QUESTIONS.map((q) => (
        <label key={q.id} className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={answers[q.id] === true}
            onChange={(e) =>
              setAnswers((a) => ({ ...a, [q.id]: e.target.checked }))
            }
            className="mt-1"
          />
          <span>{q.text}</span>
        </label>
      ))}
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <button
        onClick={submit}
        disabled={submitting}
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {submitting ? "Running gate…" : "Run gate"}
      </button>
    </div>
  );
}

export default function FindingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [title, setTitle] = useState("");
  const [vulnClass, setVulnClass] = useState("");
  const [severity, setSeverity] = useState<Severity>("INFO");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [evidence, setEvidence] = useState("");

  async function load() {
    try {
      const res = await fetch(`/api/findings?targetId=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`Failed to load findings (${res.status})`);
      setFindings(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load findings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function createFinding(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/findings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetId: id,
          title,
          vulnClass: vulnClass || undefined,
          severity,
          description: description || undefined,
          location: location || undefined,
          evidence: evidence || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Failed to create finding (${res.status})`);
      }
      setTitle("");
      setVulnClass("");
      setSeverity("INFO");
      setDescription("");
      setLocation("");
      setEvidence("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create finding");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/targets/${id}`}
          className="text-sm text-zinc-500 hover:underline"
        >
          ← Target
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Findings</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Run the 7-Question Gate on each finding before it can go in a report.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300">
          {error}
        </div>
      )}

      <form
        onSubmit={createFinding}
        className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="text-sm font-medium">Add a finding</h2>
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
        <div className="flex gap-3">
          <input
            value={vulnClass}
            onChange={(e) => setVulnClass(e.target.value)}
            placeholder="Vuln class (e.g. IDOR)"
            className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as Severity)}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
          rows={2}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Location (URL, endpoint or parameter — e.g. /api/users/{id}, ?redirect=)"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
        <textarea
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          placeholder="Evidence / proof of concept"
          rows={2}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
        <div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {submitting ? "Adding…" : "Add finding"}
          </button>
        </div>
      </form>

      <div className="space-y-3">
        <h2 className="text-sm font-medium">Findings</h2>
        {loading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : findings.length === 0 ? (
          <p className="text-sm text-zinc-500">No findings yet.</p>
        ) : (
          <ul className="space-y-2">
            {findings.map((f) => (
              <li
                key={f.id}
                className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{f.title}</span>
                      <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
                        {f.severity}
                      </span>
                      {f.confidence && (
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-medium ${CONFIDENCE_STYLE[f.confidence]}`}
                          title={
                            f.confidence === "PROVEN"
                              ? "Direct evidence in the response/behavior"
                              : "Needs manual or out-of-band confirmation"
                          }
                        >
                          {f.confidence}
                        </span>
                      )}
                      {f.vulnClass && (
                        <span className="text-xs text-zinc-500">
                          {f.vulnClass}
                        </span>
                      )}
                    </div>
                    {f.location && (
                      <p className="mt-1 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                        {f.location}
                      </p>
                    )}
                    {f.description && (
                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                        {f.description}
                      </p>
                    )}
                    {f.oobHits && f.oobHits.length > 0 ? (
                      <div className="mt-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 dark:border-emerald-800 dark:bg-emerald-950/40">
                        <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
                          OOB callbacks ({f.oobHits.length}):
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {f.oobHits.map((h, i) => (
                            <li
                              key={i}
                              className="font-mono text-xs text-emerald-700 dark:text-emerald-400"
                            >
                              {h.method} from {h.sourceIp ?? "unknown"} at{" "}
                              {new Date(h.receivedAt).toLocaleString()}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : f.oobToken ? (
                      <p className="mt-2 text-xs italic text-zinc-400 dark:text-zinc-500">
                        awaiting OOB callback…
                      </p>
                    ) : null}
                  </div>
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${GATE_STYLE[f.gateStatus]}`}
                  >
                    {f.gateStatus}
                  </span>
                </div>

                {f.gateStatus === "KILLED" && f.killedReason && (
                  <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">
                    {f.killedReason}
                  </p>
                )}

                {f.gateStatus === "UNVALIDATED" && (
                  <GateForm findingId={f.id} onDone={load} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
