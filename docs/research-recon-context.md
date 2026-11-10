# Recon evidence in persistent Research

> **Retired.** The Research console (Codex/Claude terminals, Burp bridge and their containers) has been removed from BugHunter. Research is now done manually in a local CLI. This page is kept for history only; see [Research console removal](research-console-removal.md).

Research keeps its existing target workspace and separate native Codex/Claude tmux conversations. Open **Contexte Recon** in the console, generate a snapshot, review suggestions/provenance and select **Transmettre** for the current provider. The fixed message is pasted without Enter: submit it when the provider is ready and the input is empty. `STAGED` means pasted, never that the model read or accepted it. A network timeout records `UNKNOWN`; check the console before retrying.

## Existing components reused

- `ScanRun.reconCorpus` v1, `HostDiscovery` and append-only `ScanLog`, without modifying Recon execution/results.
- Program `discoveryState`/`matchesHost`, Research `assertResearchTarget`, selected-host `assertExecutionUrl`, and the persistent console's scheme/default port restriction.
- Existing workspace ownership, immutable input files, Ed25519 terminal signing key, provider tmux identities and authenticated same-origin API conventions.
- Existing persistent sessions, hypothesis workflow, provider permissions and Burp MCP configuration. No Hunt execution or second Research engine.

## Actual supported formats

1. Persisted corpus **version 1**: redacted URLs, query parameter names, observed form/JavaScript methods and fields, authenticated-crawl flag, technology name signatures and surface booleans. No persisted response status/body or confirmed technology versions exists here; none is fabricated. An authenticated crawl does not establish that an endpoint requires authentication. A form method is a discovery, never a completed request.
2. `HostDiscovery`: subfinder, certificate transparency and scope-rule inventory with original row IDs and timestamps. Scope is recomputed against current policy, ignoring historical `VALIDATED` claims.
3. Actual stdout logs delimited by stored `$ httpx`, `$ katana`, `$ nmap` command summaries: bare httpx URLs (probe response, no status/accessibility claim), bare katana URLs (discovery), nmap TCP port/state/service labels (no service/version confirmation).
4. Stored `[dns]` JSON arrays: valid address associations only, not permission to test an IP. Arbitrary log text, titles, bodies, banners, unknown formats and technology strings are not instructions or exported observations.

All evidence has a deterministic ID, source scan/tool, original row/field references, first/last observed timestamps, current scope classification and freshness as evaluated at generation. Equivalent observations merge sources. Observations absent from a newer completed valid corpus are historical; absence is not evidence of remediation or vulnerability absence. Failed, partial, cancelled and unknown-outcome runs remain visible with warnings.

## Persistence and updates

New additive migration `20261102200000_research_recon_context` adds `ResearchReconSnapshot` and `ResearchReconDelivery`. Deploy migrations and regenerate Prisma Client before deploying web. Rebuild the Research console image for the new `/control/recon` endpoint. No persistent Codex/Claude configuration changes are needed. Historical UUID workspaces and their initial ZIPs are unchanged.

Snapshots are immutable JSONB derivatives with SHA256 digests and a unique `(sessionId, sourceFingerprint)`. Canonical JSON sorts object keys so PostgreSQL JSONB round trips preserve digests. Identical source input reuses the same snapshot and original generation timestamp. Dates used for freshness are explicit build inputs. Original source rows remain in Recon, including evidence beyond export bounds.

Workspace files `recon/snapshot-<sha256>.json` (details) and `recon/summary-<sha256>.json` (compact context) are web/root-owned, read-only and created exclusively. JSON is indented so both providers can locate a record with Grep and read a bounded line range on demand. No latest pointer or conversation context is silently rewritten. Reads check owner, size, regular-file type, link count and digests; ancestor traversal refuses symlinks. Failed DB publication can leave harmless unreferenced immutable files; the next identical publication verifies/reuses them.

The panel polls every 30 seconds. Scan/status/result/inventory or policy changes alter the source fingerprint and offer explicit regeneration. Generating does not transmit; sending records the exact snapshot/provider/session. A changed authorization snapshot requires the existing operator policy-refresh procedure before generation or transmission. Details can be read in pages of 25 via the owned API.

Input bounds: latest 60 relevant Recon runs, first 500 discoveries and 1,000 logs per run; SQL truncates each log to 16,385 characters before transfer. Host workspaces include their selected host scans and program enumeration; passive program workspaces include program scans. Overflow is explicit. Detail JSON is limited to 1 MiB; compact JSON to 24 KiB, at most 12 example endpoints and 8 suggestions. Counts describe normalized input before output truncation. The prompt contains only trusted fixed text and a validated digest, about 1 KiB, with paths for selective reads. API paging and original Recon supply further evidence.

## Deterministic prioritization

Only current, non-stale, in-scope observations are considered. Unsafe action-shaped URLs are excluded using the existing observation safety helper. Scores order suggestions; they are not vulnerability probabilities.

| Signal | Points | Interpretation |
| --- | ---: | --- |
| Administrative route name | 30 | Access control unverified |
| API/version/GraphQL route | 20 | API surface observed |
| Parameter names | 15 | Values omitted |
| Authenticated crawl | 10 | Authentication requirement unverified |
| Appears since previous retained completed corpus | 10 | Coverage may differ |
| Technology signature / observed open TCP port | 15 | Requires evidence review, no confirmed version |
| Observation older than 7 days | −10 | Aging; older than 30 days is omitted from suggestions |

Ties use stable observation IDs. At most 20 suggestions are retained. Confidence is deliberately LOW for these signals. Every suggestion includes reasons, source/observation IDs, scope ID, freshness and review mode. Existing provider permission limits still apply: Claude remains passive. Program consoles always offer passive review. Legacy free-text scope/path restrictions also force passive review because the existing data model provides structured host patterns only; no new interpretation grants path authorization. Out-of-scope history is inspectable but never suggested for active investigation.

## Trust boundary and validation limits

Recon content is untrusted evidence. It never changes system instructions, scope, provider configuration or MCP permissions. The signed short-lived delivery ticket binds session, provider, policy, both file digests and a single-use delivery ID. The runner validates protected files and the existing tmux identity before pasting trusted instructions. No browser command, path or Recon string becomes a tmux command argument or prompt instruction. Agents must continue treating selectively read JSON values as data; text tagging is not an absolute guarantee against model-level prompt injection.

Unit tests exercise normalization, scope/exclusions, dates, provenance, limits, malformed data, instruction strings, signatures, protected files and both provider adapter contracts. PostgreSQL integration tests exercise canonical persistence, ownership, refresh and delivery history with a controlled HTTP transport. `npm run test:research:recon` uses a networkless disposable runner, the installed Codex/Claude `--version`/`--help`, and real tmux with a capture fixture to verify identical bracketed paste without Enter. It does not submit a conversation to either native CLI or run a model. Real MCP rebuild checks remain separate and refuse active native CLI/tmux sessions before disruptive steps.

## File inventory

Created:

- `src/lib/research/recon.ts`, `src/lib/research/reconDelivery.ts`: shared context and signed delivery contracts.
- `src/server/research/reconContext.ts`, `reconFiles.ts`, `reconSnapshots.ts`: normalization, protected artifacts, ownership, generation, refresh and transmission.
- `src/app/api/research-targets/[id]/recon/route.ts`: authenticated summary, paging and explicit mutations.
- `src/components/ResearchReconContext.tsx`: existing-console panel.
- `docker/research/console/recon-context.mjs`: verified, provider-bound tmux staging.
- `prisma/migrations/20261102200000_research_recon_context/migration.sql`: additive tables and indexes.
- `tests/unit/researchReconContext.test.ts`, `tests/unit/researchReconDelivery.test.ts`, `tests/integration/researchReconContext.test.ts`, `tests/research/reconDelivery.mts`: evidence, API and native transport coverage.
- `docs/research-recon-context.md`: architecture, supported data, limits and delivery procedure.

Modified:

- `prisma/schema.prisma`: snapshot/delivery relations and models.
- `src/components/ResearchTerminal.tsx`: mounts the Recon panel with the selected provider.
- `docker/research/console/server.mjs`: signed internal `/control/recon` endpoint.
- `docker/research/Dockerfile`: includes the new shared delivery contract.
- `package.json`: native transport test command.
- `tests/research/mcpRebuild.mjs`: session guards before disruptive MCP validation steps.

Pre-existing provider diagnostics changes are preserved outside the mission commit. No dependency or persistent MCP/provider configuration was changed.

## Delivery validation (2026-11-02)

- Baseline `npm test`: 563 passed, 146 infrastructure/network tests skipped.
- Final `npm run test:queue`: 732 passed, 6 network tests skipped; additive upgrade preservation test passed. All databases/Redis instances were disposable and isolated from application data.
- `npm run test:network`: the remaining 6 tests passed against local HTTP/Chromium fixtures and installed scanners.
- `npm run test:research:recon`: installed Codex/Claude CLI interface and real tmux capture passed in a networkless disposable runner; no model inference.
- `npm run test:research:mcp-rebuild`: real native Codex and Claude MCP connections passed before/after Research reconstruction, Burp outage/recovery and Research restart. Same Burp container; existing auth/config/transcript hashes preserved. Services healthy afterward.
- Prisma Client generation and schema validation passed. Migration-to-schema diff using an isolated PostgreSQL shadow database was empty.
- Typecheck, ESLint and production Next.js build passed.
- `npm audit`: 16 moderate alerts in the existing ESLint dependency chain, no high/critical alerts. No dependency change or automatic audit fix was applied.
- Staged diff reviewed; no private-key blocks or token-shaped credentials detected. Only mission files/hunks staged.

The web application deployment must apply the new additive migration before serving the new API/UI. Production application data was not migrated by these validation runs.
