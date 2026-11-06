# BugHunter Web v1.0 delivery gates

Product: black-box only. Workflow: Targets → Scope → Recon → Research Plan → Research → Findings → Report. An observation is never automatically a vulnerability, and a negative test never certifies a safe surface.

1. **Research Coverage** — persistent structured tests and negative results, separated by method, action and authentication/comparison context; common Codex/Claude memory; no transcript inference or automatic Findings. See [Research Coverage](research-coverage.md).
2. **Minimal Evidence Vault** — durable evidence identity and provenance across tests, hypotheses, Findings and Reports; reference existing Recon artifacts without copying content; redact before persistence. No large document-management UI.
3. **Recon history and Diffs** — first/last seen and observed runs; NEW, CHANGED, NOT_OBSERVED_THIS_RUN, UNCHANGED; absence is not arbitrary removal. Scope never grows through discovery. Route changes to NOT_TESTED/NEEDS_RETEST where justified. Scheduling is optional.
4. **Finding lifecycle and Retest** — human promotion and review remain mandatory; retain rejected and original evidence, submission metadata, retest activities/results and historical Report distinctions.
5. **Release Audit** — feature freeze; real end-to-end and available provider/MCP acceptance, resilience, ownership/scope/secrets/SSRF/isolation, fresh install and upgrade, migrations, Docker and all required tests. Label fixtures accurately. A known blocker, high functional defect, required failing test, scope leak, secret leak or destructive migration blocks release.

Stabilize each gate before starting the next. Coverage delivery alone does not mean v1.0 is ready. White-box, new scanners and large unrelated integrations remain outside these gates.

Do not tag, advertise or display v1.0.0 until the final audit passes. At release, package.json is the single version source used by the UI; no separate hardcoded footer version. Optional commit metadata belongs in About/diagnostics. The current development version remains unchanged.

Delivery through these five gates and the remaining conditional provider acceptance are recorded in [the 2026-11-06 release audit](v1-release-audit.md). The development version remains 0.1.0; this audit is not a v1.0.0 release.
