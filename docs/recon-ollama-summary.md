# Recon console and Ollama summaries

Scope detail shows identity, Summary, scope.md and the existing live Recon console. Structured artifacts, historical runs, diffs and provenance remain stored and feed the factual exports and Research snapshots. Target keeps its compact workflow/table, Summary and Delete Target actions. Format, Type and Asset Value remain independent.

## Format ownership

Creation detects Format. `ScopeAsset.formatSource` defaults to `AUTO` for existing rows. An explicit table edit persists `MANUAL`; backfill never overwrites it. Reset re-detects the original input. The original string is preserved. Conversions requiring a different normalized authorization (including URL → domain and exact domain → wildcard) require `confirmBoundaryChange`. The UI confirms every manual choice. Incompatible conversions are rejected; the server never invents a URL scheme.

The queued ScanRun captures format/boundary/type/value. Later edits apply to new Recon; existing runs keep their captured boundary. Archiving, scope revocation, current exclusions and Target deletion still stop network activity. A changed boundary pauses existing Research; delete/reopen its console to establish the current policy. Existing snapshots are immutable.

## Summary pipeline

Existing **AiProviderConfig / OLLAMA** Settings are the sole endpoint/model source. Both must be explicitly configured. General finding-assistance provider activation does not select a different model for Recon. No console provider, tool permissions or MCP configuration is added.

The existing worker starts an independent durable PostgreSQL task loop (`ReconSummary`). It schedules terminal asset Recon with retained artifacts, then terminal Target Recon after child summaries finish. Inference never blocks scan completion or starts a scanner. A missing config leaves Recon/export usable. For v3, unavailable or invalid inference preserves a usable factual report when structured source data is available; source or authorization failures remain separate. Pending requests require a running worker.

Each record captures run, asset/Target, model, endpoint, prompt version, SHA256 input fingerprint, timestamps, status and validated structured result. Current reports use `recon-report/3`; historical `recon-summary/1` and `recon-report/2` records keep their format and renderer. Automatic scheduling is idempotent. Regenerate creates another record. Older records remain associated with their original runs. The modal identifies stale summaries and requires explicit regeneration. Target synthesis uses child summaries clearly labelled as AI interpretations, compact normalized facts, coverage and changes; raw scanner logs are never sent.

The v3 modal separates **Recon facts**, built by BugHunter from structured evidence, from the **Ollama synthesis**. Scope, observed values, references, sources and coverage remain application-owned. Unsupported AI interpretation can be omitted without discarding factual Recon. A usable report stays `READY` with explicit warnings; when no narrative can be validated, `FACTUAL_ONLY` retains the factual report and identifies whether the provider, response format or evidence validation prevented synthesis. The modal explains these conditions in ordinary language and never prints raw model responses or schema errors. The Summary button and existing modal remain the only UI; no permanent panel is added.

Preprocessing is deterministic and hierarchical: categories and factual catalogs are compacted into an adaptive budget, prioritizing authorization, auth/API evidence, hosts, network observations, technologies, dynamic endpoints and coverage. The runtime context is capped at 32,768 tokens; at most half is used for input, with output and safety reserves. The byte ceiling follows that budget rather than a fixed 16,000 bytes. Static files are counted, not listed. Omitted evidence remains in artifacts/scope.md. Oversized individual records are omitted instead of being cut into ambiguous JSON.

Ollama `/api/show` is inspected when available. Thinking controls are selected from advertised values or a bounded compatibility trial; validated mode selection is recorded separately from immutable source input. Private reasoning is never displayed. Ollama `/api/chat` receives the versioned Recon Report system instruction, JSON Schema and separate untrusted evidence. The model supplies cited interpretation; BugHunter supplies factual values and validates the narrative before use. Unsupported references, URLs, IPs, ports, technology versions and vulnerability claims cannot become facts. Secrets are redacted before inference and persistence. The UI renders text, never executable HTML or raw JSON. See [Recon methodology v2](recon-methodology-v2.md) for the underlying Recon coverage and evidence model. Ollama interpretation still requires manual evidence review.

V3 uses deterministic aliases (`E001`, `E002`, …) constrained by the decoder schema and verified again by the application; persisted citations resolve to original evidence IDs. `factsForEvidenceRefs` derives factual values only from the cited ledger rows. The factual ledger is independent of the model input budget and bounded to 1,000 rows / 512 KiB with explicit omissions. A failed second narrative validation omits only identifiable unsupported interpretations; unavailable or unreadable inference leaves a factual-only report. Target factual inventories remain independent of child AI citations.

V3 generation has a 180-second overall deadline, at most two attempts, a 256-KiB response ceiling and an output budget derived from the model context, capped at 4,096 tokens. Historical formats retain their original request bounds. Asset archive/deletion or Target deletion cancels/invalidates jobs; late responses can only update the existing RUNNING record with active parents. They never upsert or recreate deleted data.

The deterministic factual scope.md is independent of Ollama; no model prose replaces its facts.

## Deletion

Research: **Open console / Delete**. Confirmation revokes console attachment using a committed Target console tombstone, marks its exclusive workspace, calls the existing signed stop service for both native providers/tmux descendants and native conversation deletion, then removes that console's files, promotions/references and ResearchSession children. Target, Recon, Findings, summaries and global authentication/settings remain. Missing tmux/workspaces are idempotent. An unreachable stop service retains the tombstone and reports an explicit retriable failure.

Target: confirmation commits its existing deletion tombstone first. It cancels parent/child Recon and pending summaries, waits for worker-confirmed process cleanup, purges owned BullMQ jobs, stops native console sessions, removes exclusive workspaces, then deletes owned logical data, artifacts, snapshots, findings and summaries. Unrelated Targets/shared reports are preserved. External cleanup holds no long SQL transaction. Retry resumes partial cleanup; infrastructure that cannot confirm process shutdown must recover before final removal.

## Deployment

Recon Report v3 uses the existing `ReconSummary` JSON fields and needs **no new Prisma migration**. Historical migrations and rows remain unchanged. Rebuild the shared web/worker image, then recreate web and worker. The Research image and MCP topology do not change.
