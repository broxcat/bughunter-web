# Post-v1 overhaul: execution record and handoff

This work preserves `v1.0.0` at `29d35d1c4fe117f1b954b2474c1ba57933dfaddb`. This record does not create a version bump, tag change, release, public scan authorization or production data migration.

## Initial conditions

The Downloads checkout initially pointed at the release commit. `origin/main` already contained `b6371d6`, `2beb5ad`, and `25bc86d`: Recon overview, execution detail and deterministic report. They were incorporated with a fast-forward, not reimplemented. GitHub #2–#4 already tracked that work.

Five unrelated Research diagnostics files were present before this pass: modified `docker/research/console/server.mjs`, `src/components/ResearchTerminal.tsx`; untracked `docker/research/console/provider-diagnostics.mjs`, `src/components/ResearchProviderDiagnostics.tsx`, `src/lib/research/providerDiagnostics.ts`. They must remain outside this mission's commits and deployment artifact.

Read: AGENTS.md, README, package scripts, v1 audit, Target/Scope/Recon/Research architecture, Prisma schema/migration list and Compose. Next's locally installed guides for layouts/pages, navigation, route handlers and Proxy govern implementation. The route inventory is in [post-v1-route-inventory.md](post-v1-route-inventory.md).

## Budget controls

Harness profile inspected at `/home/brokcat/deepseek-harness/state/profiles/web/cordis.patch.yml`. It adds Ollama's OpenAI-compatible endpoint at `http://127.0.0.1:11434/v1` and restricts its subagent model selection to `ollama/gpt-oss:20b`. `/api/tags` confirms that model plus qwen3.6:27b and qwen3-coder:30b. Host Codex config selects gpt-6.1-sol; its separate Ollama launch config selects qwen3-coder:30b. These are separate configurations; no provider or authentication was changed.

No reliable spending ceiling or provider billing/usage counter was exposed in the inspected Harness profile. Bundled provider defaults and account balance are not certified by that override. No auxiliary agent, DeepSeek or other paid inference request is initiated by this work. Subscription status is not treated as API credit. Local tools perform searches, tests and builds. Usage/cost of the current ChatGPT/Codex session is not measurable here. Keep the $1.50 DeepSeek ceiling by continuing with zero paid auxiliary requests unless operator guidance establishes reliable accounting.

## Milestone order

1. Reliability: source route/API inventory, reproduce issues, narrow fixes, dependency review, full supported gates and disposable browser checks.
2. Targets/Scope: expose settings on Target details; edit or explicitly replace asset identities; retirement UI and exclusions; historical snapshot regression tests. Preserve the per-host execution identity.
3. Recon: audit incoming overview/timeline, add live refresh and complete historical run navigation; render actual provider attempts distinctly from planned tools.
4. Reports: retain deterministic evidence as authority; connect existing validated Settings-routed AI narrative without changing provider configuration; improve factual DNS/TLS/static/provenance coverage.
5. Scope Markdown: audit existing Target-wide endpoint and stored snapshots; align current authorization sections and partial coverage with the requested contract; preserve Research snapshots and trusted execution authorization.
6. Visual consistency: build on existing white/charcoal/red tokens, test actual light/dark themes and mobile navigation; no gratuitous replacement of working components.
7. Launcher: keep per-host consoles unless isolation-preserving migration value is demonstrated. Verify native CLI capabilities before exposing allowlisted profiles. Do not include the unrelated diagnostic work without separate review.
8. Final acceptance: fresh install/disposable upgrade, all page walkthroughs, infrastructure suites, commit-derived deployment and HTTP/database/Redis/worker/version health.

Do not advance over release-blocking failures. Required gates and actual outcomes are recorded below, including failures and untested areas.

## Reproduced defects

- #5: deterministic report called an unprobed discovered URL responsive, a skipped port phase performed, and today's program User-Agent historical. Source review also found mutable asset identity/mode, shared artifact limits starving hosts, unrecorded HTTP method defaulting to GET, planned tools labelled as used, inferred activity mode and raw metadata/Markdown injection paths.
- #6: Proxy returns a login redirect to anonymous API callers before handler 401 JSON can run. Browser documents must retain their login callback redirect.

## Architecture and remaining audit work

Business Target is `BountyProgram`; technical execution identity is `Target`. `ScopeAsset` is explicit authorization. `ScanRun.scopeAssetSnapshot`, captured plans/User-Agent/mode and Research authorization hashes are historical contracts. Discovery artifacts and Recon history never authorize assets. Reports and Findings remain separate; no automatic observation-to-Finding conversion was added.

The incoming Recon run view uses only program-level TargetReconRun IDs. `/hosts/[id]`, `/scopes/[id]`, `/hunt`, and historical Research routes must remain backward compatible. There are no top-level Findings or Reports pages in this baseline: those workflows are per Target. Do not introduce dead navigation entries for proposed paths.

Source triage identified areas requiring further reproduction/coverage before claiming a complete application audit:

- Targets and Recon list queries are unpaginated; Scope inventory is capped at 1,000, Research at 500 and session history at 50. Target/Scope filters need URL refresh/back/forward coverage, stable ordering and last-item deletion tests. Do not call a capped query pagination.
- Target detail lacks a prominent settings entry; ProgramWorkflow does not expose existing asset retirement API or asset value identity editing. Check existing Scope detail controls before adding duplicate actions.
- Incoming run detail is a server snapshot with no automatic live refresh. Complete run history and latest-run links need a single coherent path from Target.
- Recorded provider attempts exist in step details. Planned tools are not proof of execution. Exact invocation/exit timestamps are not uniformly captured; never reconstruct them.
- Current scope.md is generated by existing server endpoint; full requested section ownership, partial host completion and atomic context publication still need review. No historical workspace files were overwritten in this pass.
- Program PATCH selects policy before acquiring its transaction lock; concurrent scope removal needs targeted reproduction. Ownership checks are present, but full mutation-origin/CRUD concurrency review is incomplete.
- Full page-by-page negative-state/accessibility validation, native CLI mode capability review and final deployment remain outstanding until explicitly recorded.

## Dependencies

2026-11-06: `npm audit`: 8 moderate, 0 high/critical; `npm audit --omit=dev`: 0. All eight remain the TypeScript-ESLint/minimatch development chain. `npm view minimatch@10 version` ends at 10.2.6; latest TypeScript-ESLint 8.72.1 remains on the affected minimatch 10 range. No compatible fix was established. npm proposes an eslint-config-next downgrade to 15.5.29, which is not applied. No force fix or unsupported minimatch 11 override was used.

`npm outdated` additionally reports newer Next/eslint-config-next 16.4.5, React 19.3.1, Playwright 1.65.0, BullMQ 6.7.1, Vitest 5.1.0 and Tailwind 4.3.5, plus major Prisma/ESLint/TypeScript releases. Outdated does not establish a defect; avoid unrelated upgrade churn. Dependencies remain unchanged.

## Deployment constraints

Initial disk: 202 GB available; Docker build cache 7.755 GB (2.333 GB reclaimable). No cache/volume pruning. Existing PostgreSQL, Redis, web, worker and Research services are running; this alone is not health/version acceptance. Do not restart persistent Research tmux sessions. Do not assume historical 437 rows exist in today's fresh database. Disposable test runners own their fixtures and cleanup only their resources.

## Validated reliability checkpoint (milestone 1 remains incomplete)

Implemented fixes for #5 and #6, plus the reproducibility fix #9. Recon reports and per-host headings read captured asset identity, User-Agent, exclusions and assessment mode. Missing historical rules remain explicitly unknown instead of borrowing today's policy. Each host gets its own 400-artifact budget and a truncation notice. Discovered URLs/DNS names do not imply responsive HTTP services; skipped port phases stay unassessed; missing methods stay unrecorded. Provider attempts, versions and their recorded duration/count/failure state are distinguished from planned tools. Changes aggregate across host executions. Anonymous or merely planned personas do not imply authenticated coverage; counts come from each context's retained observations rather than copying run totals to every persona. Raw credentials and CLI password arguments are redacted, and Markdown treats evidence as text.

Anonymous protected APIs return JSON 401; document requests retain login callbacks. The queue runner gives its persistent test Redis an exclusive TMPDIR bind that survives stop/start, retains appendfsync=always, and is removed after successful container cleanup. The native Recon fixture uses disposable shared memory for Research context publication. Production timeouts, durability and authorization locks were not changed. The runner's explicit `--browser-only` mode provisions disposable base schemas and avoids repeating the full suite when debugging a browser assertion.

### Final results

| Check | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Full `npm test` through disposable queue runner | 1,430 | 0 | 17 opt-in network cases |
| Exact `npm run test:network` final rerun | 17 | 0 | 0 |
| New Recon/API browser checks, actual light/dark at 1280px and 390px | 26 | 0 | 0 |
| Native Recon tool matrix, local HTTP/DNS fixture | 9 scenarios | 0 | 0 |

The 1,447 distinct Vitest cases all executed across the full and opt-in network runs; repeated focused runs are not added again. The focused 51-case unit subset and the real PostgreSQL report-loader/owner-isolation case also passed. Native Recon used 358 local fixture HTTP requests, no public target or model. Native Codex/Claude tmux Recon delivery passed without inference. Research SSH/non-root/persistence/passive MCP/isolation infrastructure passed; its only Internet probe checked the dependency registry, not a research target. Target browser and Research browser scripts passed. The auth browser script passed its five reported groups, including the new HTTP 401/document callback checks and real Redis outage/restart. These older scripts do not expose individual assertion totals.

`npm run test:migration` passed through the disposable runner: historical identities, unknown legacy User-Agent, Research sessions, hypotheses/revisions, nullable authorization/proof and exact decimal values preserved. `prisma migrate diff --exit-code` reported no difference. These are disposable fresh-schema/upgrade fixtures, not an assertion about the current production data counts.

`npm run lint`, `npx next typegen`, `npx tsc --noEmit`, `npm run build`, `docker compose config --quiet`, and `git diff --check` passed. The build/checks include the operator's five pre-existing diagnostics files in the working checkout; those files are excluded from commits. No exact-commit Docker deployment is claimed.

### Failed attempts retained

- Original default network run: 16 passed, 1 browser startup timeout. Serial 30-second rerun and later exact default command both passed all 17.
- Disk-backed full-suite attempt: aborted after three Research transaction failures; no completed total. Ten local fsync writes took 0.984s in /tmp versus effectively 0s in /dev/shm. This exposed #8, which remains open.
- First RAM-workspace run with disk-backed Redis AOF: 1,417 passed, 11 failed, 17 skipped. An isolated first dispatch case reproduced HTTP 202 versus expected immediate 201. Its pending outbox preserved work; Redis restart timeout caused subsequent fixture failures. #9 fixes fixture placement; the final full run passes without loosening product deadlines.
- Initial native Recon run: first case reached Research handoff then expired its 15-second transaction on disk. The final RAM-backed fixture passed all nine scenarios. This does not resolve the product's slow-disk limitation (#8).
- First auth browser assertion rejected Next's valid relative login Location. The assertion now resolves against the application origin; the corrected browser script passes. No application redirect was changed to accommodate the test.

Full current native Research console/Burp stack, real model inference, a new complete every-page walkthrough, exhaustive CRUD/pagination/concurrency/accessibility, and exact-commit installation/deployment have not been repeated. Those limits prevent milestone 1 or the full overhaul from being marked complete.

### Deployment and release decision

No deployment, application migration or Research-console restart performed. Existing HTTP health returned 200 with database/Redis up; PostgreSQL readiness and Redis PONG passed; active production scans were zero when checked, with two Research records present. This is observation of the existing stack, not acceptance of newly deployed code.

Not ready for v1.1.0. #8 requires slow-disk provisioning/recovery work, and #7 retains the remaining eight-milestone acceptance checklist. The highest-priority next action is a deterministic slow-filesystem reproduction for #8 that verifies both DB rollback and exclusive workspace recovery before changing the provisioning contract. Do not skip straight to cosmetic redesign or relax Scope enforcement.

Artifacts/logs/screenshots are in `/tmp/bh-post-v1/` on this machine. No credentials or provider response bodies are included in the committed audit.

### Git handoff

- `e806eb7`: anonymous API JSON responses and actual auth/browser regressions (#6).
- `1a951bc`: truthful historical Recon reports, provider attempts, authentication contexts, redaction and SQL/unit/browser regressions (#5).
- `e66c29c`: RAM-aware durable disposable fixtures and isolated browser reruns (#9).
- All work stays on main; the five pre-existing Research diagnostics files remain uncommitted. No feature branch or pull request created.

The new `--browser-only --post-v1-browser` path also passed all 26 checks after base-schema provisioning was added. Repeat with `TMPDIR=/dev/shm TEST_POSTGRES_TMPFS=1 node tests/queue/runInfrastructure.mjs --browser-only --post-v1-browser`. To reproduce the full validation, run `TMPDIR=/dev/shm TEST_POSTGRES_TMPFS=1 npm run test:queue -- --target-browser --research-browser --auth-browser --post-v1-browser`; the corrected auth script also passed independently with `--browser-only --auth-browser`.
