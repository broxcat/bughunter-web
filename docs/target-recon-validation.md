# Target Recon playbooks — validation, 2026-11-03

Implementation and deployment are documented in [target-recon-playbooks.md](target-recon-playbooks.md).

## Scope and preservation

Reused: BountyProgram/Target/ScopeAsset, approved-scope and exclusion validators, guarded HTTP transport, BullMQ SQL outbox/execution attempts/cancellation, raw ScanLog evidence, HostDiscovery inventory, ResearchReconSnapshot and signed workspace delivery, native tmux providers and Burp adapter. The old Hunt remains retired. There is one adaptive asset executor, with historical readers for old formats.

The commit was prepared separately from five pre-existing changes: `docker/research/console/server.mjs` diagnostics hunks, `src/components/ResearchTerminal.tsx`, and the three untracked provider-diagnostics files. The server's mission changes were staged independently; both Docker images were built from the staged tree without those diagnostics changes. No production migration, database reset, volume deletion or persistent provider-config edit was performed. Test databases, volumes and local targets were disposable.

## Results

| Check | Result | Evidence / limits |
|---|---|---|
| Baseline `npm test` | PASS | 631 passed, 164 skipped before changes |
| Final standalone `npm test` | PASS | 669 passed, 180 environment-dependent skips; SQL/Redis/network suites exercised separately below |
| PostgreSQL / Redis + Target browser | PASS | 838 passed, 11 network-only skips; ownership, scope, parent/child runs, priority, capacity, archive/cancel/rerun, counts, Markdown and snapshots |
| Historical upgrade | PASS | Upgraded pre-program/pre-Research data and the deployed `20261102220000_scope_assets` schema; existing IDs, user value/type, Research history and old scan data preserved |
| Schema ↔ migration diff | PASS | No difference detected against a disposable shadow DB |
| `prisma validate`, `prisma generate` | PASS | Prisma6.19.3, PostgreSQL16 |
| lint, typecheck, Next build | PASS | Next16.4.2; local route/component guides read before implementation |
| Native HTTP / browser network tests | PASS | 11 tests: actual installed tools/Chromium plus relay path/method/redirect/revocation/backoff/resource-drain guards |
| Docker app / Research builds | PASS | Prepared commit tree, independent test tags; production services not recreated |
| Native Target-wide Recon | PASS | Web + API + wildcard local fixture, actual worker/BullMQ, HTTPX/FFUF/Nuclei/Nmap, artifacts, both briefs, full Research JSON facts and exact User-Agent; 66 local HTTP requests in the final fixture run |
| Wildcard native orchestration | PASS with explicit partial coverage | Actual Subfinder/Amass/Assetfinder run in an internal Docker network; one local host is explicitly seeded. Offline provider failure is Partial. This is not evidence that public enumeration sources discovered the seed |
| Native Recon delivery to both providers | PASS | Installed Codex/Claude version/help + actual tmux bracketed-paste transport; same content hash, no automatic Enter/model request |
| Persistent console / real Burp | PASS | Native Codex RPC, Claude initialization, official Burp history and HTTP1.1/HTTP2 local calls; signed Recon history collection preserves request/response references; outage/restart/reconnect; archive stops both PTYs but preserves Codex threads/Claude state/files |
| Historical SSH Research suite | PASS | Non-root/public-key auth, immutable inputs, writable notes, persistence, network isolation, local SSE fixture |
| `npm audit` | FAIL (existing dependency advisories) | 16 moderate findings in ESLint/minimatch toolchain; no package or lockfile change; zero high/critical |
| `npm audit --omit=dev` | PASS | Zero findings |
| `test:research:mcp-rebuild` | SKIPPED after prerequisite failure | Command attempted on the current Compose stack; no `/workspaces/research_*` workspace existed. It stopped before rebuild/restart. Separate disposable real-Burp tests above exercised builds and restart/recovery |
| Public wildcard enumeration | NOT TESTED | No arbitrary public target was scanned |
| Authenticated model investigation | NOT TESTED | Native CLI/config/MCP/transport checks are real; no claim that an authenticated model read the evidence or found vulnerabilities |

One run during concurrent Docker builds exceeded the existing5s filesystem-test deadlines (8 failures); the isolated PostgreSQL/Redis/browser rerun passed without relaxing those deadlines or changing unrelated Research code.

## Data quality and compatibility

- Counters derive from normalized artifacts. Five discovered routes produce five endpoint artifacts with zero HostDiscovery rows; no independent counter can drift from stored evidence.
- A terminal worker process with outcome FAILED is displayed as Failed. Partial, Blocked, Cancelled, stale successful data and unknown coverage are not promoted to clean completion.
- Source merges are serialized under the scan row lock. Distinct Nuclei template IDs and Burp request/response pairs remain distinct observations; DNS address families and equivalent technology names merge without losing sources.
- Invalid HTTP status values cannot establish verified accessibility. Declared methods, discovered endpoints, observed responses, inferred technology names and confirmed versions are kept distinct.
- Old raw evidence is retained. Assigned old runs are normalized once; unassigned historical readers remain compatible. New unassigned Recon requests are retired; historical idempotent replays remain supported.
- Delayed Markdown publication uses the original parent membership/run IDs, even after a newer parent starts. Asset status remains accurate beyond the first30 detailed assets in a large Target brief.
- Both providers receive the same bounded JSON + summary, including sanitized structured observation facts, confidence, freshness, current boundary/type/value and provenance. A new scan does not overwrite a live session's snapshot.

## Installed tools checked

Subfinder2.17.0, Amass4.2.0, HTTPX1.12.0, Nmap7.93, FFUF2.1.0-dev, Nuclei3.11.1. Assetfinder is built fromv0.1.1 and has no version flag; executable SHA256 recorded by preflight:

`97da8d5aa985442050f571736aa8fdc17bcf08a995a5e8d1317091635950f5bc`

Native CLI fixtures used Codex0.165.0 and Claude2.1.312. Real Burp acceptance used Community2026.10.1 with official extension1.3.0 (the upstream server reports version1.1.2). The collector records the version actually reported, rather than inventing a Burp application version.

## Remaining limits

IP/CIDR/single-label assets remain documentation-only. Native HTTP scanners use the scoped relay; remote TLS metadata comes from a separate authorized TLS connection. Summaries are bounded (Target≤1000 assets, detailed intelligence first30, artifact detail sample1000; full inventory paginated), Markdown≤128KiB, Research detail≤1MiB/summary≤24KiB. HTTP and HTTPS remain separate services. Missing/removed observations from a bounded scan do not prove disappearance or absence of vulnerabilities. Known optional-tool and blocking limitations are retained explicitly.

Deployment commands and the full format/type/value budget matrix are in [the playbook guide](target-recon-playbooks.md#deployment).

## Changed files

```text
Dockerfile
README.md
docker/research/Dockerfile
docker/research/console/recon-observations.mjs
docker/research/console/server.mjs
docker/research/validator/burp-http.mjs
docs/target-recon-playbooks.md
docs/target-recon-validation.md
docs/target-recon-workflow.md
prisma/migrations/20261103160000_adaptive_recon_playbooks/migration.sql
prisma/schema.prisma
src/app/(dashboard)/research/page.tsx
src/app/(dashboard)/scopes/[id]/page.tsx
src/app/(dashboard)/scopes/page.tsx
src/app/(dashboard)/targets/[id]/findings/page.tsx
src/app/(dashboard)/targets/[id]/page.tsx
src/app/(dashboard)/targets/[id]/settings/page.tsx
src/app/(dashboard)/targets/page.tsx
src/app/api/internal/recon-observations/route.ts
src/app/api/programs/[id]/assets/[assetId]/recon/route.ts
src/app/api/programs/[id]/recon/route.ts
src/app/api/scan-runs/route.ts
src/app/api/scope-assets/[id]/artifacts/route.ts
src/app/api/scope-assets/route.ts
src/components/HostFindings.tsx
src/components/ProgramWorkflow.tsx
src/components/ReconArtifactBrowser.tsx
src/components/ScopeAssetDetails.tsx
src/components/TargetSettings.tsx
src/lib/observationSafety.ts
src/lib/reconArtifacts.ts
src/lib/reconPipeline.ts
src/lib/reconPlanner.ts
src/lib/research/recon.ts
src/lib/research/reconCollection.ts
src/lib/scopeAssets.ts
src/proxy.ts
src/server/execution.ts
src/server/queue/executionAttempts.ts
src/server/queue/executionMaintenance.ts
src/server/queue/processScan.ts
src/server/queue/scanRequest.ts
src/server/queue/worker.ts
src/server/recon/artifacts.ts
src/server/recon/assetPipeline.ts
src/server/recon/burpCollection.ts
src/server/recon/intelligence.ts
src/server/recon/nucleiPolicy.ts
src/server/recon/parsers.ts
src/server/recon/protection.ts
src/server/recon/targetRuns.ts
src/server/recon/templates/bughunter-recon-api.yaml
src/server/recon/templates/bughunter-recon-auth.yaml
src/server/recon/templates/bughunter-recon-headers.yaml
src/server/recon/templates/bughunter-recon-panel.yaml
src/server/recon/toolArguments.ts
src/server/recon/toolLimits.ts
src/server/recon/toolchain.ts
src/server/recon/transport.ts
src/server/recon/wordlists/api.txt
src/server/recon/wordlists/web.txt
src/server/research/archiveAsset.ts
src/server/research/reconContext.ts
src/server/research/reconInputs.ts
src/server/research/reconSnapshots.ts
src/server/scanners/runCommand.ts
src/server/scanners/toolPolicy.ts
src/server/scopeAssets.ts
src/server/scopeMarkdown.ts
tests/e2e/targetAssetWorkflow.mjs
tests/e2e/targetWorkflow.mjs
tests/integration/programWorkflow.test.ts
tests/integration/scopeAssets.test.ts
tests/integration/targetReconPlaybooks.test.ts
tests/migrations/programUpgrade.mjs
tests/network/reconRelay.test.ts
tests/recon/assetTools.mts
tests/recon/runAssetTools.mjs
tests/research/portSwiggerAcceptance.mjs
tests/research/runConsole.mjs
tests/unit/assetPipeline.test.ts
tests/unit/reconArtifacts.test.ts
tests/unit/reconCollection.test.ts
tests/unit/reconPlanner.test.ts
tests/unit/scanRoutes.test.ts
tests/unit/scanWorker.test.ts
tests/unit/scanWorkerLifecycle.test.ts
tests/unit/scopeAssets.test.ts
tests/unit/scopeMarkdown.test.ts
```
