# Recon console and Ollama summaries

Scope detail shows identity, Summary, scope.md and the existing live Recon console. Structured artifacts, historical runs, diffs and provenance remain stored and feed the factual exports and Research snapshots. Target keeps its compact workflow/table, Summary and Delete Target actions. Format, Type and Asset Value remain independent.

## Format ownership

Creation detects Format. `ScopeAsset.formatSource` defaults to `AUTO` for existing rows. An explicit table edit persists `MANUAL`; backfill never overwrites it. Reset re-detects the original input. The original string is preserved. Conversions requiring a different normalized authorization (including URL → domain and exact domain → wildcard) require `confirmBoundaryChange`. The UI confirms every manual choice. Incompatible conversions are rejected; the server never invents a URL scheme.

The queued ScanRun captures format/boundary/type/value. Later edits apply to new Recon; existing runs keep their captured boundary. Archiving, scope revocation, current exclusions and Target deletion still stop network activity. A changed boundary pauses existing Research; delete/reopen its console to establish the current policy. Existing snapshots are immutable.

## Summary pipeline

Existing **AiProviderConfig / OLLAMA** Settings are the sole endpoint/model source. Both must be explicitly configured. General finding-assistance provider activation does not select a different model for Recon. No console provider, tool permissions or MCP configuration is added.

The existing worker starts an independent durable PostgreSQL task loop (`ReconSummary`). It schedules terminal asset Recon with retained artifacts, then terminal Target Recon after child summaries finish. Inference never blocks scan completion or starts a scanner. A missing config leaves Recon/export usable; unavailable/invalid inference marks only the summary Failed. Pending requests require a running worker.

Each record captures run, asset/Target, model, endpoint, prompt version `recon-report/2` (historical `recon-summary/1` is retained), SHA256 input fingerprint, timestamps, status and validated structured result. Automatic scheduling is idempotent. Regenerate creates another record. Older records remain associated with their original runs. The modal identifies stale summaries and requires explicit regeneration. Target synthesis uses child summaries clearly labelled as AI interpretations, compact normalized facts, coverage and changes; raw scanner logs are never sent.

Preprocessing is deterministic and hierarchical: categories and factual catalogs are compacted into an adaptive budget, prioritizing authorization, auth/API evidence, hosts, network observations, technologies, dynamic endpoints and coverage. The runtime context is capped at 32,768 tokens; at most half is used for input, with output and safety reserves. The byte ceiling follows that budget rather than a fixed 16,000 bytes. Static files are counted, not listed. Omitted evidence remains in artifacts/scope.md. Oversized individual records are omitted instead of being cut into ambiguous JSON.

Ollama `/api/show` is inspected when available. Thinking controls are selected from advertised values or a bounded compatibility trial; validated mode selection is recorded separately from immutable source input. Private reasoning is never displayed. Ollama `/api/chat` receives the versioned Recon Report system instruction, JSON Schema and separate untrusted evidence. Zod validates the professional narrative, sections, cited observations, coverage and Research handoff. Factual guards reject unsupported references, URLs, IPs, ports, technology versions and vulnerability claims. Secrets are redacted before inference and persistence. The UI renders text, never executable HTML or raw JSON. Historical summary1 output still renders. See [Recon methodology v2](recon-methodology-v2.md) for exact coverage, budget and validation rules. The output remains an AI interpretation; manual evidence review is required.

Requests time out after 120 seconds, responses are capped at 128 KiB and output at 2,400 tokens. A worker interrupted for over three minutes leaves a Failed record that can be regenerated. Asset archive/deletion or Target deletion cancels/invalidates jobs; late responses can only update the existing RUNNING record with active parents. They never upsert or recreate deleted data.

The deterministic factual scope.md is independent of Ollama; no model prose replaces its facts.

## Deletion

Research: **Open console / Delete**. Confirmation revokes console attachment using a committed Target console tombstone, marks its exclusive workspace, calls the existing signed stop service for both native providers/tmux descendants and native conversation deletion, then removes that console's files, promotions/references and ResearchSession children. Target, Recon, Findings, summaries and global authentication/settings remain. Missing tmux/workspaces are idempotent. An unreachable stop service retains the tombstone and reports an explicit retriable failure.

Target: confirmation commits its existing deletion tombstone first. It cancels parent/child Recon and pending summaries, waits for worker-confirmed process cleanup, purges owned BullMQ jobs, stops native console sessions, removes exclusive workspaces, then deletes owned logical data, artifacts, snapshots, findings and summaries. Unrelated Targets/shared reports are preserved. External cleanup holds no long SQL transaction. Retry resumes partial cleanup; infrastructure that cannot confirm process shutdown must recover before final removal.

## Deployment

Additive migration: `20261103220000_recon_summaries` (format provenance, console revocation marker, durable summaries with cascading ownership). Historical migrations remain untouched. Rebuild the shared web/worker image, deploy the migration, recreate web and worker. The Research image/MCP topology do not change.
