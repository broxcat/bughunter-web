# Recon console and Ollama summaries

Scope detail shows identity, Summary, scope.md and the existing live Recon console. Structured artifacts, historical runs, diffs and provenance remain stored and feed the factual exports and Research snapshots. Target keeps its compact workflow/table, Summary and Delete Target actions. Format, Type and Asset Value remain independent.

## Format ownership

Creation detects Format. `ScopeAsset.formatSource` defaults to `AUTO` for existing rows. An explicit table edit persists `MANUAL`; backfill never overwrites it. Reset re-detects the original input. The original string is preserved. Conversions requiring a different normalized authorization (including URL → domain and exact domain → wildcard) require `confirmBoundaryChange`. The UI confirms every manual choice. Incompatible conversions are rejected; the server never invents a URL scheme.

The queued ScanRun captures format/boundary/type/value. Later edits apply to new Recon; existing runs keep their captured boundary. Archiving, scope revocation, current exclusions and Target deletion still stop network activity. A changed boundary pauses existing Research; delete/reopen its console to establish the current policy. Existing snapshots are immutable.

## Summary pipeline

Existing **AiProviderConfig / OLLAMA** Settings are the sole endpoint/model source. Both must be explicitly configured. General finding-assistance provider activation does not select a different model for Recon. No console provider, tool permissions or MCP configuration is added.

The existing worker starts an independent durable PostgreSQL task loop (`ReconSummary`). It schedules terminal asset Recon with retained artifacts, then terminal Target Recon after child summaries finish. Inference never blocks scan completion or starts a scanner. A missing config leaves Recon/export usable; unavailable/invalid inference marks only the summary Failed. Pending requests require a running worker.

Each record captures run, asset/Target, model, endpoint, prompt version `recon-summary/1`, SHA256 input fingerprint, timestamps, status and validated structured result. Automatic scheduling is idempotent. Regenerate creates another record. Older records remain associated with their original runs. The modal identifies stale summaries and requires explicit regeneration. Target synthesis uses child summaries clearly labelled as AI interpretations, compact normalized facts, coverage and changes; raw scanner logs are never sent.

Preprocessing is deterministic and capped at **16,000 bytes**, prioritizing authorization, auth/API evidence, hosts, network observations, technologies, dynamic endpoints and coverage. Static files are counted, not listed. Omitted evidence remains in artifacts/scope.md. Oversized individual records are omitted instead of being cut into ambiguous JSON.

Model thinking parameters are left at the selected model’s defaults (some models such as GPT-OSS cannot disable thinking). Ollama `/api/chat` receives a versioned system instruction, JSON Schema and separate untrusted evidence. Zod validates `executiveSummary`, typed `sections` containing text/evidence references, `researchPriorities` and `limitations`. Unknown references, unsupported URLs and explicit unsupported confirmation claims are rejected. Secrets are redacted before inference and persistence. The UI renders text, never executable HTML or raw JSON. Output remains an AI interpretation, not evidence, authorization or a Finding. These controls cannot guarantee factual correctness of model prose; manual review remains required.

Requests time out after 120 seconds, responses are capped at 128 KiB and output at 2,400 tokens. A worker interrupted for over three minutes leaves a Failed record that can be regenerated. Asset archive/deletion or Target deletion cancels/invalidates jobs; late responses can only update the existing RUNNING record with active parents. They never upsert or recreate deleted data.

The deterministic factual scope.md is independent of Ollama; no model prose replaces its facts.

## Deletion

Research: **Open console / Delete**. Confirmation revokes console attachment using a committed Target console tombstone, marks its exclusive workspace, calls the existing signed stop service for both native providers/tmux descendants and native conversation deletion, then removes that console's files, promotions/references and ResearchSession children. Target, Recon, Findings, summaries and global authentication/settings remain. Missing tmux/workspaces are idempotent. An unreachable stop service retains the tombstone and reports an explicit retriable failure.

Target: confirmation commits its existing deletion tombstone first. It cancels parent/child Recon and pending summaries, waits for worker-confirmed process cleanup, purges owned BullMQ jobs, stops native console sessions, removes exclusive workspaces, then deletes owned logical data, artifacts, snapshots, findings and summaries. Unrelated Targets/shared reports are preserved. External cleanup holds no long SQL transaction. Retry resumes partial cleanup; infrastructure that cannot confirm process shutdown must recover before final removal.

## Deployment

Additive migration: `20261103220000_recon_summaries` (format provenance, console revocation marker, durable summaries with cascading ownership). Historical migrations remain untouched. Rebuild the shared web/worker image, deploy the migration, recreate web and worker. The Research image/MCP topology do not change.
