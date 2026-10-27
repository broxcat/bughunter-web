"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import EvidenceReview from "@/components/EvidenceReview";
import { findingReviewStatus, type ReviewState } from "@/lib/evidenceReview";
import {
  ClassificationChips,
  FindingClassification,
} from "@/components/FindingClassification";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

type Severity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type Confidence = "CANDIDATE" | "PROVEN";

interface Finding {
  id: string;
  huntMetadata?: unknown;
  title: string;
  vulnClass: string | null;
  severity: Severity;
  confidence: Confidence | null;
  description: string | null;
  location: string | null;
  evidence: string | null;
  gateStatus: string;
  reviewStatus: ReviewState;
  reviewEvidence: { notes?: string } | null;
  killedReason: string | null;
  cwe: string | null;
  cvssVector: string | null;
  cvssScore: number | null;
  impact: string | null;
  remediation: string | null;
  oobToken?: string | null;
  oobHits?: { receivedAt: string; sourceIp: string | null; method: string }[];
}

const SEVERITIES: Severity[] = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

// Semantic scale → Badge tone. severity maps to its own name lowercased.
const SEVERITY_TONE: Record<Severity, BadgeTone> = {
  INFO: "info",
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
};

const REVIEW_TONE: Record<ReviewState, BadgeTone> = { CANDIDATE: "candidate", EVIDENCE_REVIEW: "info", CONFIRMED: "passed", REJECTED: "killed", INCONCLUSIVE: "neutral" };

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
    fetch(`/api/findings?targetId=${encodeURIComponent(id)}`).then(async res => {
      if (!res.ok) throw new Error("Unable to load findings");
      setFindings(await res.json());
    }).catch(e => setError(e.message)).finally(() => setLoading(false));
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
          href={`/hosts/${id}`}
          className="text-sm text-muted hover:text-foreground"
        >
          ← Host
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          Findings
        </h1>
        <p className="mt-1 text-sm text-muted">
          Review reproducible evidence and impact before confirming a finding for a report.
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

      <Card className="p-4">
        <form onSubmit={createFinding} className="grid gap-3">
          <h2 className="text-sm font-medium text-foreground">Add a finding</h2>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Finding title"
            placeholder="Title"
            className="rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-subtle"
          />
          <div className="flex gap-3">
            <input
              value={vulnClass}
              onChange={(e) => setVulnClass(e.target.value)}
              aria-label="Vulnerability family"
            placeholder="Vuln class (e.g. IDOR)"
              className="flex-1 rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-subtle"
            />
            <select
              aria-label="Finding severity"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Severity)}
              className="rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-foreground"
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
            aria-label="Finding description"
            placeholder="Description"
            rows={2}
            className="rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-subtle"
          />
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            aria-label="Finding location"
            placeholder="Location (URL, endpoint or parameter — e.g. /api/users/{id}, ?redirect=)"
            className="rounded-md border border-border-strong bg-surface px-3 py-2 font-mono text-sm text-foreground placeholder:text-subtle"
          />
          <textarea
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            aria-label="Finding evidence"
            placeholder="Evidence / proof of concept"
            rows={2}
            className="rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-subtle"
          />
          <div>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? "Adding…" : "Add finding"}
            </Button>
          </div>
        </form>
      </Card>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">Findings</h2>
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : findings.length === 0 ? (
          <p className="text-sm text-muted">No findings yet.</p>
        ) : (
          <ul className="space-y-2">
            {findings.map((f) => (
              <li key={f.id} id={`finding-${f.id}`}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {f.title}
                        </span>
                        <Badge tone={SEVERITY_TONE[f.severity]}>
                          {f.severity}
                        </Badge>
                        {f.vulnClass && (
                          <span className="text-xs text-subtle">
                            {f.vulnClass}
                          </span>
                        )}
                        <ClassificationChips f={f} />
                      </div>
                      {f.location && (
                        <p className="mt-1 font-mono text-xs text-muted">
                          {f.location}
                        </p>
                      )}
                      {f.description && (
                        <p className="mt-1 text-sm text-muted">
                          {f.description}
                        </p>
                      )}
                      {f.oobHits && f.oobHits.length > 0 ? (
                        <div className="mt-2 rounded-md border border-border bg-surface-2 px-3 py-2">
                          <p className="flex items-center gap-2 text-xs font-medium text-foreground">
                            <Badge tone="proven">OOB</Badge>
                            callbacks ({f.oobHits.length}):
                          </p>
                          <ul className="mt-1 space-y-0.5">
                            {f.oobHits.map((h, i) => (
                              <li
                                key={i}
                                className="font-mono text-xs text-muted"
                              >
                                {h.method} from {h.sourceIp ?? "unknown"} at{" "}
                                {new Date(h.receivedAt).toLocaleString()}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : f.oobToken ? (
                        <p className="mt-2 text-xs italic text-subtle">
                          awaiting OOB callback…
                        </p>
                      ) : null}
                    </div>
                    <Badge tone={REVIEW_TONE[findingReviewStatus(f)]} className="shrink-0">
                      {findingReviewStatus(f)}
                    </Badge>
                  </div>

                  {findingReviewStatus(f) === "REJECTED" && f.killedReason && (
                    <p className="mt-2 text-xs text-muted">{f.killedReason}</p>
                  )}

                  <EvidenceReview key={`${f.id}-${f.reviewStatus}`} finding={f} onDone={load} />

                  <FindingClassification
                    key={`${f.id}-${f.cvssVector}-${f.cwe}`}
                    finding={f}
                    onSaved={load}
                  />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
