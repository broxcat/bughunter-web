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

## Issue #8 — recoverable Research provisioning (2026-11-07)

This section records the follow-up to the checkpoint above; it does not replace the earlier failed-attempt history or certify the broader overhaul.

### Reproduced failure

On `95c912f`, a test-only AsyncLocalStorage hook delayed the console publisher for 16.1 seconds immediately after atomic rename. Assertions proved **zero committed ResearchSession rows** for that console Target and **a published workspace directory still on disk**. A same-Target retry then failed with “Workspace already exists.” The old callback exceeded its 15-second interactive transaction deadline. This is demonstrated DB/filesystem divergence, rather than an inference from source. The original baseline test and log are retained locally in `/tmp/bh-issue8/baseline-test.ts` and `baseline.log`.

### Reservation, publication and admission

The existing `CREATING` state is now a committed reservation. One additive nullable `ResearchSession.publicationManifest` JSONB column holds the server-generated session/Target/workspace identity, policy fingerprint, unique attempt token, expected file hashes/sizes, directory structure and UID/GID/modes. It holds hashes rather than another copy of workspace contents. Existing READY and historical rows are not backfilled or rewritten.

Provisioning performs a short reservation/capture transaction, durable publication outside SQL, then a short admission transaction. Admission locks Target, Scope, Program and applicable ScopeAsset records, checks current ownership/authorization/deletion state, compares policy identity and the exact manifest that was verified, and only then commits READY. The published candidate remains web-owned and group-inaccessible (`2700`) until that commit. Durable group admission (`2750`) follows outside SQL, with a final short authorization check before returning. Every transaction retains the existing 15-second limit. Ordinary already-active READY reconnects need only reservation/read and final admission checks. No terminal ticket or ZIP download is authorized by a CREATING reservation or by Markdown/filesystem discovery.

A stable private lock inode under `.provisioning-locks/` serializes writers across local processes sharing the same workspace mount. `flock` locks the parent's open-file description through an inherited descriptor; the helper exits and the parent retains the lock until its FD closes. Process death releases the lock automatically. A CREATING row whose lock can be acquired is recoverable; no heartbeat, wall-clock lease or PID guessing is needed. A competing caller waits at most 30 seconds, then receives a safe busy response if the owner is still active. Lock inodes are deliberately retained, never unlinked on release. Explicit console deletion shares this lock; program deletion commits its tombstone and drains prior publishers before filesystem cleanup.

Files are staged under a unique token-specific temporary name, written with the existing permissions, fsynced, checked against the trusted manifest, and all required directories fsynced. Linux `renameat2(RENAME_NOREPLACE)` publishes without replacing even an unexpected empty directory or symlink. The parent directory is fsynced afterward. Legacy ZIPs are independently staged, fsynced and atomically published without replacement. `flock`, Python 3 and Linux descriptor/rename support are already present in the supported application image; unsupported operations fail closed. Multi-host or non-local filesystem locking semantics are not certified by these tests.

### Recovery and preservation invariants

- Before directory publication, only the DB reservation's token-specific temporary paths may be discarded. Cleanup validates ownership, known structure and non-symlink entries, then removes only whitelisted entries using descriptor-relative unlink/rmdir. A final legacy ZIP must match the reserved digest/size before interrupted-export cleanup can remove it; unexpected archives are preserved and refused. It never uses a blanket recursive removal of a final workspace. Unexpected temporary contents fail closed.
- After rename but before READY commit, failure leaves CREATING plus a complete candidate. Retry must verify that candidate against the **DB** manifest, exact session/Target identity, permissions and current policy. It adopts the same bytes/session without overwriting the final directory.
- A separate-OS-user test reproduced an unsafe intermediate design: a group-readable CREATING candidate could be opened directly through the shared filesystem, bypassing the web ticket gate. Candidates now remain private to the web UID through READY commit. The same test proves no Research-group read before commit and normal read afterward. This relies on the supported image's distinct web and Research UIDs, as does its existing immutable-input contract; no runner rebuild or new runner-side protocol is required.
- If no candidate was published, retry may recapture non-authoritative Recon context under the unchanged authorization snapshot. The DB Recon/Plan references are updated with the newly prepared files. If a candidate was published, its original context and references remain frozen. Regression tests cover Recon completing between the interrupted attempt and retry.
- After READY commit, process death may leave either a still-private candidate or an active workspace. A private candidate is fully verified and activated on an authorized retry; its original inventory/Coverage is retained for this recovery call and refreshed on the next ordinary reconnect. An active workspace preserves operator notes and immutable authorization inputs; it never enters incomplete-publication cleanup. Inventory/Coverage refresh I/O is also outside provisioning transactions and followed by authorization revalidation. Revocation during post-commit permission I/O blocks the response and subsequent opens; the already-committed READY row remains a historical snapshot, just as other READY rows do after later revocation.
- Policy revocation/drift during publication prevents READY admission. An orphan is never a source of authorization; a retry still validates current Scope and rejects stale policy. A stale reservation is not silently reauthorized.
- Unknown pre-existing final directories, including pre-fix orphans with no trusted DB reservation, are refused and never automatically adopted, overwritten or deleted. They require explicit operator review/deletion through the existing authorized flow.
- Legacy creation keeps distinct server-generated UUIDs and its existing creation quota. An identified interrupted legacy reservation can be recovered by the trusted server helper `resumeResearchSession`; a fresh create remains a distinct session. Historical exports and ZIPs are not rewritten. Invalid roots are now rejected before reservation (409, no falsely active row), replacing the old synthetic FAILED-row behavior for that preflight error; existing FAILED rows remain unchanged.

### Validation record

Focused failure injection uses actual PostgreSQL. The controlled slow-I/O performance case always forces a disk-backed `/tmp` workspace, even when the general runner uses `TMPDIR=/dev/shm`; other injected crash windows honor `TMPDIR` to avoid unnecessarily saturating Docker's backing disk during full regression. Earlier focused runs exercised all these windows on disk as well. Hooks are reachable only through explicit test-context injection, never a browser field or production delay setting. They cover durable writes, before/after rename, before READY, rollback after the READY update but before commit, and process death before/after group admission. Separate child-process fixtures prove lock release and cross-process concurrent recovery. A separate deterministic test holds publication beyond the actual 30-second lock wait, requires a busy 409, releases the owner and proves a safe same-session retry without losing its staging files.

The first focused Research/legacy/deletion run passed 118 tests. Additional recovery review caught and reproduced an inconsistent Recon reference when fresh evidence arrived before a retry; the DB metadata now follows the recreated files, while adopted published candidates retain their original references. A focused test assertion was corrected to accept rejection at the earlier ownership/mode guard for a hostile empty directory. Neither correction relaxed a product integrity check.

Initial controlled slow-I/O measurements included 24.2 seconds of publication with SQL transactions of 55/9 ms, and 17.0 seconds with 51/11 ms. The final run's exact measurements and complete gate outcomes are appended below. No filesystem speed claim is made: the safety property is that durable I/O can exceed the former transaction deadline without an interactive transaction spanning that I/O.

Validation artifacts are local under `/tmp/bh-issue8/`. A dedicated application test image is built from the baseline plus this issue's source changes, excluding all five unrelated diagnostics WIP files. The existing Research image and production services are not rebuilt/restarted. The additive migration is tested only on disposable databases; production migration/deployment is outside this milestone. Other existing Research context/delivery transaction designs are unchanged; this fix addresses initial workspace provisioning, its recovery, and console reconnect admission.

The native console harness initially observed zero official MCP tools while its reverse SSH tunnel/Java proxy were initializing. Its initial five-tool assertion now polls the actual local fixture inventory with a 45-second readiness deadline and checks that the tunnel is still alive, rather than treating a 600ms head start as proof of readiness. The inventory, proxy, revocation, reconnect and persistence assertions remain enabled; no native provider/console implementation or diagnostics WIP was changed for this fixture correction.

Additional failed attempts are retained in the local logs. A full run concurrent with Docker layer unpacking passed 1,437 cases and failed 11 Redis restart/dispatch fixture cases (17 network skips); subsequent quiescent intermediate runs passed 1,450, 1,453 and 1,456 cases as coverage grew. Two default network attempts each passed 16 cases and hit one five-second browser startup timeout; a quiet `TMPDIR=/dev/shm npm run test:network` passed all 17. The final-image native suite completed every application assertion, including proxy, revocation, persistence, archive and running-console deletion, but its Compose teardown exceeded the fixture's 60-second command bound. A scoped five-second-grace teardown removed only that verified disposable project; its volumes were checked by project label before removal. Fixture teardown now uses this explicit five-second grace and retries a killed cleanup command at most once, without changing any application or transaction deadline. A later native Recon transport attempt also timed out starting its disposable Docker container; these infrastructure failures are not recorded as application acceptance.

A heavily loaded full attempt with all new crash cases on disk passed 1,455 and failed two (17 network skips): a concurrent caller correctly returned the documented bounded busy 409, which the test had incorrectly required to be immediate success, and Docker exceeded the Redis outage fixture's stop deadline. Kernel diagnostics recorded Docker daemon threads blocked on a mutex for over 122 seconds; I/O pressure was high despite ample free space. No daemon or production service was restarted. The test now requires safe same-session retry after busy, plus a separate deterministic 30-second held-owner case. Other fault-injection cases honor `TMPDIR`, while the performance case still proves publication on actual `/tmp` storage. That loaded run's performance case itself passed: 45,523ms publication, 341ms permission activation, 46,041ms total, with SQL transactions of 57/10/7ms.

The revised focused seven-file run passed 128 tests. A subsequent full run passed 1,457 and failed only the permission probe's Docker startup timeout (17 network skips). The permission test now first verifies a local privilege-drop route (root or existing passwordless sudo/setpriv), otherwise uses the isolated Docker identity. Both routes perform an actual filesystem read as UID 65534 with only the Research group, requiring denial before READY and success afterward. It changes no sudoers, provider, runner or application permissions. The local route passed its targeted rerun; earlier focused runs passed the Docker route. The final complete gate results are recorded below, without adding focused reruns to the distinct case total.

### Final Issue #8 gate results

| Check | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Focused Research, legacy, workspace and deletion subset (7 files) | 128 | 0 | 0 |
| Full `npm test` through disposable queue runner | 1,458 | 0 | 17 opt-in network cases |
| `TMPDIR=/dev/shm npm run test:network` | 17 | 0 | 0 |
| Post-v1 browser matrix (light/dark, desktop/mobile) | 26 | 0 | 0 |

All 1,475 distinct Vitest cases executed across the full and network runs. The focused subset overlaps these totals; 26 provisioning cases and two root guards are new. The local privilege-drop permission probe also passed its targeted rerun. Target, Research and authentication browser scripts passed; their individual assertion totals are not exposed. The complete queue command, including fixture cleanup, exited zero:

```sh
TMPDIR=/dev/shm TEST_POSTGRES_TMPFS=1 npm run test:queue -- --target-browser --research-browser --auth-browser --post-v1-browser
```

`npm run test:migration` passed both independently and through that runner. Historical identities, authorization/proof nullability, legacy Research/hypothesis snapshots and decimal values were preserved. `prisma migrate diff --exit-code` reported no difference. The new nullable manifest column was applied only to disposable databases.

`TMPDIR=/dev/shm RESEARCH_TEST_APP_IMAGE=bughunter-issue8-test:local npm run test:research` exited zero, including the SSH/isolation foundation and complete native browser/PTY/HTTP proxy/archive/deletion console suite and teardown. This covers concurrent provisioning, reconnect, policy revocation, immutable inputs, workspace isolation and persistence across the fixture's restart. `TMPDIR=/dev/shm npm run test:research:recon` exited zero for both Codex and Claude native transport. No model inference or genuine Burp Suite acceptance was attempted; the latter remains an optional separately configured workflow. Research targets were disposable local fixtures; the foundation's dependency-registry egress probe was not a target scan.

The final full run measured **32,735ms filesystem publication**, **56ms durable permission activation**, **32,984ms total provisioning**, and **61/10/7ms SQL transactions**. The performance case asserts three transactions, each under five seconds, and no transaction at publication or activation entry. It injects 16.1 seconds of latency on a real `/tmp` workspace and verifies the published file there. The earlier 45.5-second disk case remains evidence of storage sensitivity; no slow-disk speedup is claimed.

`npm run lint`, `npx next typegen`, `npx tsc --noEmit`, `npm run build`, `docker compose config --quiet`, and staged/unstaged `git diff --check` passed. Local build checks include the five original diagnostics WIP files; the isolated native application test image excludes them and matches the issue's runtime/schema changes. Their original checksums remain unchanged, and they are excluded from the fix commit.

Issue #8's provisioning/recovery acceptance is complete on the supported Linux/local shared-mount deployment. Unknown pre-fix directories without a trusted reservation still require explicit operator review; multi-host/non-local filesystem locking is not certified. No production deployment, production migration, Research image rebuild, provider-authentication change or persistent production tmux restart occurred. No DeepSeek API calls were issued (estimated additional DeepSeek spend $0; account billing is not independently observable).

This closes only #8 and its part of milestone 1. The remaining overhaul checklist in #7 is unfinished; this is not full application acceptance or a v1.1.0 release decision. Package version, historical v1.0.0 tag/release and existing authorization snapshots are unchanged.

## Milestone 1 follow-up checkpoint (base 95eba04)

The existing 21-page / 67-handler inventory was reused, not regenerated. Issue #8 remains closed; its provisioning regression tests still pass. This checkpoint does **not** complete Milestone 1 or authorize moving to Milestone 2.

### Confirmed Program policy race (#10)

Two real-PostgreSQL barrier tests pause PATCH after its pre-lock read, then commit a competing writer's added rule and ScopeAsset before PATCH acquires its lock. Before the fix, removing that newly added rule returned 200 despite RUNNING Recon (expected 409); without running Recon, the rule was removed while its asset incorrectly remained active. Both regression assertions failed on 95eba04. PATCH now reads current rules after its existing FOR UPDATE lock and derives removals from that row. The active-Recon conflict and asset retirement semantics are preserved. No filesystem operation or additional timeout was introduced. The focused Program workflow suite passes 23 cases, including both races; this concern was confirmed, not disproven.

### Collection triage — remaining work

| Collection | Actual current behavior | Remaining acceptance |
| --- | --- | --- |
| Targets / Recon program lists | Complete, unpaginated; company-name ordering without a unique tie-breaker | Large-list navigation and tie ordering still need implementation/scale regression |
| Scope inventory | At most 1,000 assets; backfill also considers at most 1,000 programs; no page/cursor | A single large Target can exceed the cap; Target filtering alone cannot guarantee access to all assets |
| Research consoles | At most 500 queried Targets, then authorization filtering and priority sorting | Earlier SQL truncation can hide otherwise authorized entries; not pagination |
| Research historical sessions | At most 50, newest first | Older sessions need reachable collection navigation; not pagination |
| Legacy session API | At most 100, newest first | Compatibility-preserving navigation/count contract remains to be designed and tested |
| Program Findings / Reports API | At most 1,000 Findings / 100 Reports | Validate and fix access beyond caps without breaking array consumers |
| Asset Recon detail | Recent 30-run history; artifact rendering at 1,000 with an explicit truncation flag | Distinguish intentional bounded evidence rendering from complete history navigation |

These are source-reviewed limits, not new speculative GitHub defects or claimed pagination fixes. Unique ordering, first/middle/last/invalid/out-of-range pages, filter state, empty results and last-row deletion still require collection-specific acceptance. Existing capped responses are not certified safe by this checkpoint.

### Negative-state and interaction coverage

The disposable post-v1 browser fixture now runs 116 additional checks from the checked-in inventory: 64 anonymous protected API URLs require JSON 401 without redirects; 18 protected document URLs preserve login redirects and exact bookmark/query callbacks; 29 authenticated missing-resource GET URLs must return a defined negative-state status rather than success, redirect or server failure; one foreign owner's empty program list remains isolated; four light/dark and desktop/mobile navigation cases verify visible initial keyboard focus, no horizontal overflow, refresh and back/forward query preservation. Missing-resource checks allow each handler's existing 400/403/404/409/410 semantics; they are a surface guard, not an exact-status proof for every method and owner combination. The API route inventory includes multiple methods per handler; these checks do not claim all mutations were exercised.

Remaining: collection pagination/filter acceptance, all CRUD ownership/conflict/idempotency variants, malformed IDs and retired/deleted historical references per workflow, all dialogs/forms/error labels, keyboard containment and contrast checks. Existing full-suite lifecycle/retirement/ownership tests remain useful evidence but do not substitute for this unfinished audit. No Target/Scope redesign, global visual redesign, Research architecture change or production deployment was performed.

### Validation and dependency review

- Focused Program workflow: **23 passed, 0 failed**. Pre-fix race reproduction: **2 failed**, as expected, with 21 unrelated cases filtered out.
- Required full queue command with Target, Research, auth and post-v1 browser flags: **1,460 passed, 0 failed, 17 opt-in network skips**, exit zero including migration/drift/browser checks and fixture cleanup.
- Separate network command: **17 passed, 0 failed, 0 skipped**. There are **1,477 distinct Vitest cases** across full/network runs; focused reruns are not added.
- New browser matrix: **116 passed, 0 failed, 0 skipped**; existing report matrix **26 passed**. Target, Research and auth browser scripts passed (individual assertion totals are not exposed).
- Additive upgrade via `npm run test:migration` and schema drift passed. Lint, Next typegen, TypeScript, build, Compose config and diff checks passed. No provider execution or Burp integration code changed, so real inference/Burp acceptance was not required or attempted.
- `npm audit`: **8 moderate development advisories**, no high/critical; `npm audit --omit=dev`: **0**. Registry review still ends minimatch 10 at 10.2.6 and typescript-eslint at 8.72.1; no compatible safe patch was established. Retain the accepted tooling risk; no force fix, major override or Next downgrade applied.

Logs are in `/tmp/bh-m1/`. The five diagnostics WIP files retain their starting checksums and remain excluded from commits. No DeepSeek/auxiliary inference requests were made; account billing is not observable. Production services, volumes, provider authentication, persistent tmux sessions, package version and historical release/tag were not changed. Issue #7 must remain open with Milestone 1 unchecked until the remaining acceptance work above is completed.

## Milestone 1 collection, mutation and accessibility completion pass (base 5f37d9f)

This pass reuses the 21-page/67-handler inventory and preserves the preceding audit checkpoints as historical facts. #8 and #10 remain closed; no Milestone 2 work, production deployment, package version change, tag or release was started.

### Reproduced defects and fixes

The focused issue set is #11–#30. Targets/Recon now have bounded server pages instead of loading the entire Program list (#11); Scope no longer hides rows beyond 1,000 or stops compatibility repair at 1,000 Programs (#14); Research no longer truncates hosts at 500, history at 50 or legacy session reads at 100 (#15). Findings and saved Reports remain reachable beyond 1,000/100 (#16), read-only Hunt history beyond 100 (#19), Evidence Vault beyond its first 100 retained records (#20), and hypotheses/revisions retain URL filters and clamp beyond-end pages (#21). Previous-host adoption inventory is server-paged with a minimal projection (#29). Technical-host ScanRun history is server-paged and transfers a Finding count instead of every Finding body (#30); its Scope breadcrumb now uses the Program filter rather than confusing a Program ID with an asset ID.

Owner predicates stay in SQL. New count/clamp/rows reads use Repeatable Read; sort keys include a unique tie-breaker. Filters and independent page keys survive refresh/back/forward. Final-row deletion/adoption and external fixture removal recover to a valid page. Each request is a fresh snapshot, not an immutable export spanning multiple page requests. Compatibility array shapes remain complete; primary lists explicitly request bounded responses. No speculative indexes, schema migration, new CRUD capability, session migration or pagination of fixed provider enums was introduced.

[Collection contracts](post-v1-collection-audit.md) classify every reviewed collection as SMALL_FIXED_COLLECTION, UNBOUNDED_SAFE, CAPPED_NOT_PAGINATED, PAGINATED or CURSOR_PAGINATED. Deliberate recent/context/evidence budgets remain explicitly capped, not relabelled as pagination. Recent-run windows now expose limits/truncation and the diff selector declares its latest-50 processing window. The live log viewer declares its recent 2,000-line window; comparison previews state their limits. Missing coverage remains unknown. Artifact pages count/clamp/read together; immutable snapshot pages clamp and distinguish absent historical fields from observed empty collections (#25).

The [supported mutation-method audit](post-v1-crud-audit.md) records **53 methods across 46 mutating handlers** in the existing 67-handler inventory: 51 protected entries and two public account/authentication entries, no PUT. Its 152 inventory-driven cases cover protected anonymous admission, browser Origin and malformed/missing-resource admission; state, owner, stale/conflict, concurrent and repeat semantics are covered by the documented real-SQL workflow suites. These are layered checks, not a Cartesian assertion for every imaginable payload. Historical immutable records and deliberately retired 410 routes remain so. Private Program/console deletion retains its existing idempotent 200 behavior rather than receiving a fabricated uniform 404.

Explicit foreign-Origin writes are rejected before mutation on 14 legacy entry points (#17). Finding/Scope/credential updates and parent-removal races return their existing private/invalid-reference semantics rather than an unhandled Prisma exception (#18). A two-Program barrier proves legacy host adoption now has exactly one winner; conditional ownership update makes the loser 409 and rolls back its Scope-rule edit, preserving original Scope/ScanRun identity (#24). Finding review now uses current Scope Asset/discovery-parent authorization rather than only the historical active flag (#27). Readiness rejects empty active Scope and retiring Programs (#28). Malformed nonempty Summary input can no longer be interpreted as approval for optional synthesis; input is strict, bounded, and checked before scheduling (#26). Scheduler probes were mocked, with no model call or paid work.

The [functional accessibility record](post-v1-accessibility-audit.md) describes the 21-page matrix and its limits. Shared Dialog focus/Escape (#12), editable-control and dark subtle-text contrast (#13), terminal keyboard escape (#22) and nested Host controls (#23) were fixed narrowly. Native CLI Tab remains default; Ctrl+Shift+M opts into web navigation without changing persistent-session security or provider behavior. Both themes and viewport sizes are covered. This does not claim formal accessibility certification or a new native transport/image acceptance run.

### Disproven concerns and failed attempts

Updating Program metadata did not by itself prove the proposed list-reordering scenario; unique sorting is covered directly instead. Known older owned asset run IDs were already directly readable beyond the recent-30 selector; the positive test preserves that contract, while recent/diff window bounds are now stated honestly. The existing endpoint-preview first-50 disclosure was already adequate and was left intact. Native radio groups correctly use a single Tab stop; the fixture was corrected to test arrow navigation rather than label native behavior a defect.

Initial artifact boundary fixtures omitted required first/last-seen dates. After correcting those fixtures, four cases were rerun against the saved pre-fix handler and independently failed on actual page clamping; the fixture errors are not counted as product reproduction. Reusing the legacy API suite's disposable public schema produced a fixture-cleanup foreign-key error; its rerun used a fresh schema. One browser iteration used an unsuccessful build and correctly failed readiness; a later typed build succeeded. Contrast CSS was verified in compiled browser output after an initial selector rule was optimized away.

A late full attempt passed 1,689 and failed 14 (17 network skips): a disposable Redis stop/start exceeded its test deadline and caused ten queue failures; four credential metadata cases assumed localhost despite the configured AUTH_URL. The credential fixture now explicitly stubs/restores its public origin; production origin validation was not relaxed. A subsequent in-progress run picked up four new Host-history regression cases before the updated handler was loaded; it is not treated as final-source acceptance. All failed attempts are retained in `/tmp/bh-m1-final/`. Final gate results follow only after a stable-source rerun.

The first frozen-source run passed all 1,713 unit/integration cases (17 network opt-ins skipped) and migration/drift, then the new previous-host browser case caught a real 390px form overflow. The existing adoption form now wraps and constrains its selector. A simultaneous standalone network attempt passed 16 and timed out one Playwright case at its unchanged five-second deadline; it is rerun without concurrent heavy acceptance work. A Host effect iteration also triggered the React set-state-in-effect lint rule and was corrected by tracking the loaded request identity, rather than disabling the rule. These failed attempts are not counted as passing gates.

### Final validation

The final combined command exited **zero**, including all browser scripts and disposable-service teardown:

```sh
TMPDIR=/dev/shm TEST_POSTGRES_TMPFS=1 npm run test:queue -- --target-browser --research-browser --auth-browser --post-v1-browser
```

| Gate | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Full Vitest through disposable queue runner (129 passing files) | 1,713 | 0 | 17 opt-in network cases in 3 skipped files |
| Separate network, all 3 files, one worker | 17 | 0 | 0 |
| Existing Recon report/browser integrity checks | 26 | 0 | 0 |
| Inventory-driven negative browser checks | 116 | 0 | 0 |
| Program collection/dialog/contrast browser checks | 12 | 0 | 0 |
| Scope/Research/management/Hunt navigation matrix | 20 | 0 | 0 |
| Previous-host adoption navigation matrix | 4 | 0 | 0 |
| Technical-host history navigation matrix | 4 | 0 | 0 |
| Findings/Reports navigation matrix | 16 | 0 | 0 |
| Hypothesis/revision/Evidence Vault navigation | 4 | 0 | 0 |
| Accessibility page/theme/viewport matrix | 84 | 0 | 0 |

There are **1,730 distinct Vitest cases** across full/network acceptance. The final full run took 295.07 seconds for Vitest. The new focused files contribute 253 cases (23 Program/cap tests, 37 collection boundary tests, 16 detail/history tests, 14 mutation/concurrency tests, 152 method-admission tests, 11 Summary input tests); these overlap the full count and are not added again. Browser totals are **286 named checks/matrix cases**, not a count of every internal assertion. The existing Target, Research and authentication browser workflows also passed; they do not expose individual assertion totals.

The successful separate network command was `npm run test:network -- --maxWorkers=1`; it executes the same 17 local-fixture tests with their unchanged deadlines, avoiding concurrent Chromium startup. No public target scan or provider inference was performed.

`npm run test:migration` passed inside the final runner, preserving historical ScanRun/Finding/Report/item/credential identities, legacy Research sessions/hypotheses/revisions, unknown historical UA/proofs/authorization and decimal values. Schema drift reported **No difference detected**. No new migration/index was needed. `npm run lint`, `npx next typegen`, `npx tsc --noEmit`, `npm run build`, `docker compose config --quiet`, and staged/unstaged `git diff --check` passed. Local web checks include the five preserved diagnostics WIP files; new committed code does not depend on the three untracked diagnostics files. Fresh native PTY/image, model inference and genuine Burp acceptance are not claimed for this read/navigation/admission pass; previous #8 native acceptance remains separately recorded.

`npm audit --omit=dev`: **0 vulnerabilities**. `npm audit`: **8 moderate development advisories**, no high/critical. Registry review found minimatch 10.2.6 and typescript-eslint 8.72.1; no safe compatible fix for the accepted tooling chain was established. No forced fix, major override, Next downgrade or dependency/lockfile change was made.

The first frozen run's Docker remove call timed out for its disposable execution Redis; a follow-up inspect confirmed the container had been removed. Its exact owned tmpfs fixture directory was then removed. The standalone SQL/browser fixtures were removed by name after verifying their disposable labels. The final required runner completed its own cleanup successfully. No production service, volume, workspace or persistent tmux session was restarted or deleted.

Runtime/tests were validated through implementation commit **3fc7e8d**, with the final documentation commit adding these records only. The five original diagnostics files retain their starting SHA-256 hashes and remain outside the commits. The v1.0.0 tag still resolves to 29d35d1c4fe117f1b954b2474c1ba57933dfaddb; package version and published release are unchanged. No DeepSeek or auxiliary inference requests were issued (additional DeepSeek spend $0 from this work; account billing is not independently observable).

**Milestone 1 acceptance is complete.** #8 remains closed; the Program PATCH race remains fixed; collection/cap/order, supported-method CRUD/concurrency, negative states, practical keyboard/form/dialog/contrast/responsive acceptance and required gates pass. The focused defects #11–#30 are verified for closure after the validated commits are pushed. #7 remains open for Milestones 2–8. This is not complete overhaul/release acceptance and no v1.1.0 decision or production deployment occurred. Work stops here.

## Milestone 2 — Target settings and immutable Scope management (base 309ffc0)

The isolated worktree started at the latest origin/main, verified to contain 309ffc018780aca46b98f1826d0307ebbe8b2977. The primary checkout's five Research diagnostics files remained untouched and outside the worktree, tests and commits. Dependencies were installed in the isolated tree; no production .env, Research workspace or credentials were copied. Milestone 1 is not rerun as development work; its regression gates are retained.

### Acceptance evidence

| Criterion | Delivered behavior | Proof |
| --- | --- | --- |
| Visible Target settings | Keyboard-accessible settings link on the Target; existing form edits Program metadata, User-Agent, rules and exclusions; direct URL, return/success state, absent-resource error, mobile layout | `milestone2ScopeManagement.mjs`: settings/required-field/exclusion/direct-error flow in both themes at 1280/390px; existing auth/navigation matrix |
| Authorized metadata edits | Classification and priority remain editable, normalization unchanged; forms and inline saves use current updatedAt tokens; saving, server validation/conflict and success are visible | `scopeManagement.test.ts`: metadata/current token/stale token/invalid enum/direct-value refusal; browser real409 held-write probe, retry after reload, saved metadata |
| Explicit identity replacement | Technical Format and normalized value are immutable on PATCH. The existing Format selector opens an explicit replacement dialog with normalized preview and authorization confirmation. Existing create/admission and retirement primitives share one owned Program lock/transaction | Pre-fix #31 probe returned200 instead of409; fixed probe and manual Format replacement pass. Duplicate/invalid/stale failures retain current execution; an actual PostgreSQL failure trigger after replacement creation proves full rollback |
| Capacity, duplicate and concurrent semantics | 1,000-active quota and unique normalized value preserved; one-for-one replacement works at quota. Exactly one concurrent replacement wins. Current-version retirement racing replacement cannot revive the old identity | Real SQL quota fixture, dual replacement and retirement/replacement cases; existing Program lock and unique-key tests |
| Retirement from Target/Scope | Shared actions on Target and Scope detail, explicit asset/consequences/Cancel confirmation; Scope inventory links to management and labels archives. Queued/running scans receive cancellation and summaries are cancelled; trusted current authorization denies new execution | SQL retirement/captured-context denial; browser Cancel/keyboard confirmation, retired detail, last active row on final filtered Target page, archived Scope filter/clamp |
| Historical identity/evidence | BountyProgram remains business identity; ScopeAsset authorizes; Target remains a separate execution identity. Old Target host/scheme/Scope IDs, ScanRun snapshots, Report and Research snapshots are not rewritten | Exact SQL row/JSON equality before/after URL replacement; browser checks identical historical rows and a distinct replacement Target/Scope; current Scope/readiness/Research regressions |
| Historical route compatibility | Existing owned legacy host REMOVE/EDIT return the existing Target shape while retiring any bound ScopeAsset in the same transaction; legacy absent/private/status conventions retained | Two pre-fix #33 cases left asset.active=true; fixed REMOVE/EDIT and failed duplicate replacement cases prove authorization denial and rollback, plus existing legacy suites |
| Exclusions | Existing Target Settings add/edit/remove UI is reachable from Target and Scope; current server policy is checked again, with stale Settings409 | SQL current execution denied after exclusion, allowed after explicit removal; browser adds/removes exclusion through the actual form and checks owned API scanRejection |
| Cleanup/recovery | Replacement creation failure leaves original usable. A committed replacement returns201 with an explicit warning if native cleanup is unconfirmed. DELETE503 explicitly says authorization is already retired; historical detail supports retry. No native process is automatically restarted | SQL transport-failure/retry cases; browser uses an explicitly absent disposable signing key/control destination, observes the committed-warning path and preserved Research rows; no production/native session contacted |

### Invariants and bounds

All mutations retain the owned non-deleting Program lock. Slow native/filesystem cleanup happens after database commit; no database transaction spans it. Replacement is a short existing metadata transaction, without a distributed state machine or schema addition. Historical ScanRun.scopeAssetSnapshot, Reports, Research authorization/recon snapshots and immutable workspace evidence retain their existing contracts. Discovery/Recon history never supplies authorization. Source generations or provider/model execution were not changed.

The database's existing `(programId, normalizedValue)` uniqueness also reserves retired identities. Reauthorization may reuse that same retained Format/value identity; it cannot reinterpret its Format or rewrite the old technical Target. A different Format with the same normalized value is rejected rather than rewriting history or changing the schema. No automatic migration/repair of pre-Milestone-2 historical Format overrides is attempted. Existing unsupported executor formats remain documentary. Current policy and stale-policy checks remain authoritative, never Markdown or old discovery.

### Reproduction, failed attempts and limits

- #31: URL-to-wildcard confirmed PATCH deterministically returned200 before the fix; the new identity-refusal assertion failed. After the fix it returns409 and leaves the old Target/Scope identity unchanged.
- #33: both legacy host REMOVE and EDIT left the bound ScopeAsset active before the fix; two real-SQL assertions failed. The existing retirement primitive is now shared under the same transaction.
- A development attempt passed237/failed3: two existing method-matrix cases had no configured AUTH_URL in the clean worktree, and the new manual-format replacement accidentally passed a preview-only `requiresConfirmation` property to Prisma. Explicit identity-field selection fixed the latter, with a dedicated regression; the fixture now stubs/restores its own origin. A corrected five-file run passed242, then246 after adding legacy/cleanup cases. No assertion/deadline was weakened.
- The first browser pass passed the existing84-view accessibility matrix and navigation checks, then timed out on the new classification selector's implicit label. Explicit names were added to the three new selectors; the complete24-case Milestone2 matrix passes. The initial clean-worktree tsc invocation lacked Next's generated LayoutProps; typegen was then run before tsc as required. Compose validation initially refused missing isolated configuration; only synthetic configuration is used for its final check.
- Baseline GitHub CI at309ffc0 was already red: run42335817949 had two undeclared-origin fixture failures, a five-second export test timeout and a Burp proxy classification failure under parallel load. CI now uses the documented runner's single-worker scheduling, retaining original deadlines/assertions. The unchanged native-toolchain job exhausted the hosted runner disk (`No space left on device`, check128292380916); this is not local disk/production exhaustion and no local pruning or native image rebuild is used as a workaround. Pushed CI verification is recorded in #7; native toolchain/provider/Burp acceptance is not claimed by the Scope UI pass.

### Final clean-source gates

All checks below ran from the clean isolated worktree, without any of the five diagnostics files/changes. The final combined command exited zero, including disposable teardown:

```sh
TMPDIR=/dev/shm TEST_POSTGRES_TMPFS=1 npm run test:queue -- --target-browser --research-browser --auth-browser --post-v1-browser
npm run test:network -- --maxWorkers=1
```

| Check | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Full Vitest (130 passing files, 3 network files skipped) | 1,737 | 0 | 17 opt-in network cases |
| Separate local-fixture network suite | 17 | 0 | 0 |
| Focused five-file Scope/Program/admission/normalization regression | 246 | 0 | 0 |
| Standalone method matrix with AUTH_URL unset externally | 155 | 0 | 0 |
| Existing post-v1 browser checks/matrix cases | 286 | 0 | 0 |
| New Milestone 2 browser matrix | 24 | 0 | 0 |

There are **1,754 distinct Vitest cases** across full/network acceptance. The focused runs overlap the full total. The 21 new Scope cases plus three new method-admission cases add24 tests to the Milestone1 baseline; the existing technical-Format test is updated to assert explicit replacement, archived execution denial and retained identity reauthorization rather than permit in-place rewriting. No test deadline was changed. Browser totals are310 named checks/matrix cases, not individual assertions. The existing Target, Research and authentication browser workflows also passed (their individual assertion counts are not exposed).

Lint, Next typegen, TypeScript, build, Compose validation and working/staged diff checks pass. Compose used a temporary synthetic .env in the isolated tree, removed immediately after config --quiet; the operator's .env was neither read nor copied. The supported migration-preservation script and schema-drift check passed through the final runner even though schema/migrations are unchanged. Package/lockfile are unchanged. npm audit production0, development8 moderate: the previously accepted tooling risk is unchanged.

The actual new-code CI outcome and pushed SHA are linked from issue #7 after integration; baseline CI limitations above are retained instead of inventing successful remote/native results. Local acceptance does not claim production deployment, fresh native PTY/model/genuine Burp acceptance or a release decision. No model/provider execution, native image contract or persistent console service was modified or restarted. No public target scan, DeepSeek or other paid auxiliary inference was used.

The implementation satisfies the Milestone2 local acceptance criteria. Integration uses focused commits pushed directly to origin/main without a branch/PR/force/tag/release. The primary checkout's five original WIP files are checked by their starting SHA-256 hashes and excluded from every commit. Milestone3 and the remaining overhaul are not started. Issue #7 remains open; final integration/CI verification is recorded there.

### Milestone 2 integration follow-up — dialogs and CI diagnostics

The initial 24-case browser matrix did not hold the edit dialog open across an actual sorting poll. Before marking #7 complete, the stronger #34 probes found three issues on fd53a61:

1. A real external priority change followed by the five-second page poll replaced the dialog's version prop. Saving old form values then returned200 instead of409. Dialogs now capture an immutable copy of the asset/version on opening.
2. Moving its table row removed the native dialog from the top layer (`:modal` became false) despite the open attribute, and Escape stopped working. The Scope dialog now uses a body portal, preserving native containment and opener focus during reordering.
3. Retired-view cleanup omitted its version. Explicit reauthorization between opening and cleanup then returned200 and revoked the new authorization. Cleanup now always sends the captured version; the actual browser request returns409 and current authorization remains active. A matching SQL regression verifies the backend guard independently.

The strengthened Milestone2 browser matrix has28 named cases across both themes and 1280/390px. No test deadline or original expected status was relaxed. The intermediate Escape timeout and both incorrect200 responses are retained in `/tmp/bh-m2/` as pre-fix evidence.

The first pushed code's web CI (run42357524252) eliminated the origin and parallel-load failures but still failed the pre-existing CONNECT502 test. It captured proxyConnectStatus502/remoteStatusnull while curl exited7; the diagnostic's exit-code priority incorrectly said the proxy was unreachable. #35 moves only that diagnostic precedence into a pure helper, with five deterministic code5/7/56/absence cases, retaining all existing real local-proxy assertions. Request authorization/routing/sending/headers/TLS settings are unchanged and no target HTTP response is invented. This validator module is an image input and would need the ordinary image rebuild at a future deployment; no production image/container was rebuilt or restarted here. Genuine Burp and native image/PTY acceptance are not claimed for this error-label change; local proxy fixtures and pushed web CI are the evidence.

The final follow-up required combined runner exited zero, including migration/drift, Target/Research/auth browsers and disposable teardown. Full Vitest: **1,743 passed, 0 failed, 17 opt-in network skips** (130 passing files, 3 skipped network files); separate network: **17 passed, 0 failed, 0 skipped**, single worker with unchanged deadlines. All **1,760 distinct Vitest cases** execute across both runs. The focused follow-up SQL/proxy subset passes38 (22 Scope +16 proxy). Browser acceptance is **314 named checks/matrix cases**: existing286 plus strengthened28; focused counts overlap and are not added twice. The final Vitest phase took219.17 seconds.

Lint, typegen, TypeScript and clean-source build pass again after the follow-up; no WIP file is present in that worktree or its commits. Compose remains unchanged and its synthetic-config check passes; schema/migration and package/lockfile remain unchanged. Both migration preservation and drift pass again through the supported runner. Staged/working diff checks pass. No production deployment, public scan, persistent console restart, version/tag/release or paid auxiliary inference occurred. The native-toolchain CI job is unchanged; actual pushed web/native results are recorded with their run links in #7 rather than assuming the whole CI is green.

### Milestone 2 pushed CI verification

Runtime and tests are pushed through **acc67790f293d2f70ea8ee37cc91066c2ad9f153**. [Web CI job128363029380](https://github.com/broxcat/bughunter-web/actions/runs/42358955431/job/128363029380) is **successful**: install, typegen, lint, TypeScript, build, **1,714 passed /0 failed /46 opt-in infrastructure-network skips**, and upgrade preservation. The skipped29 queue cases and17 network cases are exercised by the successful local disposable runner/network commands above. This validates the clean code on CI's Node22 as well as the local Node24 checks; the CONNECT502 assertion now passes unchanged.

The same workflow's unchanged native-toolchain job128363029623 was still running at handoff; no overall-green workflow/native result is claimed. Both prior native jobs failed with hosted-runner `No space left on device`, including run42357524252/check128358775136. Dockerfile/tool pins are unchanged. Native CI disk capacity remains a separate operational/release limit, not certified by the web/Scope acceptance. Genuine Burp/native image deployment is not claimed; the only validator change is diagnostic precedence and remains a future image input.

This last record is documentation-only, marked `[skip ci]` to avoid starting the unchanged large native build again for documentation. Runtime/test content is identical to the verified acc6779 tree; the final remote documentation SHA and tracker verification are reported in #7. The original checkout is fast-forwarded on main, with exactly the five original diagnostics WIP files unchanged by SHA-256; the isolated worktree is clean. All disposable local test containers were removed after checking their task labels. No deployment, release/version/tag change, public target scanning, paid inference or persistent production-session restart occurred.

**Milestone 2's Target/Scope criteria and relevant clean-source/web CI acceptance are complete.** #7 remains open for later milestones. The still-running/unvalidated native-toolchain CI job and the earlier disk failure remain explicit limits; this is not a complete v1.1 release-readiness decision. Work stops before Milestone3.

Final CI poll: the unchanged native job128363029623 subsequently **failed** with hosted-runner `System.IO.IOException: No space left on device`, matching both prior runs. The overall workflow is therefore **failed**, while web job128363029380 remains **successful**. Operational issue #36 tracks this separate native-build disk blocker; no infrastructure change/pruning is attempted during Milestone2. Target/Scope criteria and clean local/web acceptance remain complete, but global native/release acceptance is blocked. This final outcome note is documentation-only and uses `[skip ci]`; runtime/tests remain identical to acc6779.

## CI #36 — native build disk investigation (2026-11-07)

The native job on `acc67790f293d2f70ea8ee37cc91066c2ad9f153`, [run 42358955431](https://github.com/broxcat/bughunter-web/actions/runs/42358955431/job/128363029623), exhausted the hosted disk during **Build pinned scanner toolchain and run offline native acceptance**. Its runner annotation records `System.IO.IOException: No space left on device` even for the runner's diagnostic log. Both the CLI and GitHub connector return `BlobNotFound` for the detailed logs (also on run 42357524252). There are no historical before/after space samples; the precise compiler invocation responsible cannot be established from the surviving annotation. The sibling web job passed; this is not evidence of a failed product assertion.

The targeted correction serializes the three native build stages in a job-owned BuildKit builder and removes Go compiler/module scratch before committing each install layer. Scanner pins, binaries, offline network isolation, smoke assertions and deadlines are unchanged. Disk is sampled before, every 30 seconds during, before/after cache removal in build stages, and after the build and exact job-owned builder/image cleanup. No global prune, installed SDK deletion, local production build or volume cleanup is performed. YAML parsing, smoke-script syntax and diff whitespace checks passed locally. Native acceptance remains pending until the pushed SHA's hosted job completes; #36 must remain open without that proof.

### CI #36 resolution proof

Commit `7faf12e7d1d83f8a2650903b4cf52db3550346ac` is pushed. [Run42361119755](https://github.com/broxcat/bughunter-web/actions/runs/42361119755) is **SUCCESS**: native job128369527851 and web job128369528023 both passed on that exact SHA. #36 is closed with those links. Native output: `READY`,12 native fixture result entries,46 loopback requests, including expected soft-404 refusals, exact/wildcard DNS, controlled nmap port and all4 Nuclei templates without Sonic warnings. Coverage/assertions/deadlines and scanner/compiler/template pins are unchanged.

Hosted root disk samples:16GiB available before build; minimum periodic sample7.0GiB;7.4GiB after image load;15GiB after exact job-owned builder/image cleanup. Per-stage scratch removal: passive11→12GiB available, Nuclei8.3→12GiB, main scanner installs8.6→11GiB (rounded `df -h` output). This demonstrates a successful bounded build, not a retrospective measurement of the crashed old runner. The old failure cannot be attributed to one compiler invocation because its detailed logs were not published. Web CI:1,714 passed/0failed/46 opt-in skips; upgrade preservation passed. This resolves the native disk blocker; it does not certify Milestone3 or release readiness by itself.

## Milestone 3 — live Recon and complete retained history (base adee8f6)

Acceptance implementation and evidence:

| Criterion | Change and regression proof |
| --- | --- |
| Live persisted data | The existing dynamic run page merges RSC refreshes after a read-only5s exact-run heartbeat on the existing Program Recon GET. Same-status RUNNING updates include new logs, artifacts/report facts and real provider attempts. No scan, queue dispatch, policy or Scope write occurs during reads. `reconRunNavigation.test.ts` and the extended post-v1 browser fixture cover this. |
| Terminal/error lifecycle | QUEUED/RUNNING poll; a rendered COMPLETED/FAILED/CANCELLED snapshot stops polling. Network/503 failures retain readable evidence and retry with bounded10/20/30s backoff; a hung heartbeat has a10s request bound.401/404 stops with an explicit access/run message. SQL covers all terminal statuses; browser verifies transient503 recovery and zero subsequent heartbeat after Completed/Failed. |
| Reading/interactions | RSC merges retain native details and focus. An explicit DOM reading anchor compensates for report growth above the viewport; user wheel/touch/navigation-key scrolling cancels compensation. Text selection defers refresh until copying ends. Browser checks opened logs, focused summary, reading-anchor position and selection/resume. |
| Complete history | Existing `/recon?program=<id>` now opens history rather than redirecting to the Target. Server count/clamp and bounded rows share RepeatableRead and owner-scoped queries;25 default/100 maximum, `createdAt DESC,id DESC`. No recent-10 cap on complete navigation, no full-table client pagination. SQL fixtures0/1/25/26/51/101, tied timestamps, first/middle/last/beyond-end,100-row boundary and insertion/removal/final-row recovery. Existing index suffices; no schema change. |
| Coherent Target navigation | Target workflow exposes Latest Recon and Complete Recon history; the Recon row exposes History; detail links back to the same business Target and the originating history page. Existing run IDs/routes and legacy `?program=` links remain valid. Browser covers empty, queued/running, failed/partial, unknown historical result, old direct run beyond page1, keyboard links, refresh/back/forward and last-page recovery. |
| Data/access invariants | Timeline/provider rendering is unchanged: planned tools remain labelled, real recorded failures/fallback attempts remain distinct, historical missing outcomes stay unknown. Exact-run heartbeat binds owner+Program+run, so it cannot substitute the latest run or reveal another account's run. SQL/browser assert private404, anonymous401, no Scope/outbox writes and immutable execution snapshots. |
| Desktop/mobile | Existing post-v1 application harness extended, no parallel application suite. New history/live matrix runs light/dark at1280/390px, keyboard Enter and native details, horizontal table containment, correct theme and no viewport overflow. All browser requests remain on disposable local fixtures. |

Intermediate failures/retries are retained: the first SQL fixture attempted two active runs and correctly hit the existing unique constraint (29pass/3fail); the corrected newer-run fixture is terminal, and focused SQL/timeline/report verification passes32/32. The first browser attempt used the wrong planned-tool separator; fixed to the existing `·` presentation without changing product rendering. The next browser run proved that preserving numeric scroll position alone moves the reading anchor when report facts grow; explicit anchor restoration was added, and the focused four-view matrix then passed36/36. No assertion/deadline was weakened. A final full-matrix selection/copy and cross-owner pass is required below.

Validation and integration results will be appended after the clean-source combined runner and pushed runtime CI finish. This checkpoint does not yet mark Milestone3 complete. No Milestone4 report redesign, production deployment, public scan, paid auxiliary inference, Research restart, schema/dependency/version/tag/release change. The original five diagnostics WIP files remain outside this isolated worktree and byte-identical under `/tmp/bh-m3/wip.sha256`.

The first combined runner passed1,755 Vitest tests (17 separately passed network opt-ins), upgrade/drift, 313 pre-M3 post-v1 checks (the final global page-error check was not reached), then stopped at the new cross-owner document assertion: HTTP200 was incorrectly assumed to imply an accessible resource. Installed Next documentation explicitly allows a streamed200 shell followed by not-found UI. The new test now verifies the404 screen, `noindex` and absence of the private Target's data; the owned heartbeat/API still requires exact404. No product access predicate was relaxed. Ambiguous repeated `program` parameters are now rejected before history lookup instead of being passed as arrays to Prisma. The clean final combined runner is repeated after these corrections; prior results do not certify the final UI bundle.

### Milestone 3 final clean-source local gates

- Focused SQL/timeline/report:32 passed/0failed, including12 new exact-run/history SQL cases. The strengthened isolated M3 browser matrix passes41/41 (including4 cross-owner document/API cases and selection/copy); its earlier36-case matrix also passed after the reading-anchor fix.
- Final supported combined command: `TMPDIR=/dev/shm TEST_POSTGRES_TMPFS=1 npm run test:queue -- --target-browser --research-browser --auth-browser --post-v1-browser` exits0. Vitest:131 passed files/3 opt-in files skipped, **1,755 passed/0failed/17 opt-in network cases skipped**. Separate final `npm run test:network -- --maxWorkers=1`: **17/17**,0failed/0skipped, unchanged deadlines (1,772 distinct executed Vitest cases across both runs; focused cases overlap).
- Post-v1 browser: **355 named checks/matrix cases**,0failed/0skipped:26 common checks,116 negative states,12 Program collections,20 Scope/Research collections,4 legacy host,4 host history,16 Finding/Report,4 Research evidence,84 accessibility views,28 M2 Scope and41 M3 Recon. No page exceptions or foreign browser requests. Separate supported Target-assets, Research and authentication workflows all pass; those scripts do not expose a comparable scalar case total.
- Additive migration preservation and schema drift exit0 (`No difference detected`); no new schema/migration. Final lint, Next typegen, TypeScript, production build, synthetic-environment `docker compose config --quiet` and `git diff --check` pass. Final application build precedes the combined runner's browser phase; source digests are unchanged after validation. No production environment was copied. Temporary Compose `.env` was exclusively created, content-checked and removed.
- `npm audit`:8 moderate development advisories, accepted ESLint tooling chain; `npm audit --omit=dev`:0. No dependency, major-upgrade override or force fix.
- Both failed and final runners removed their exact disposable containers; no remaining `bughunter.queue-test=disposable` resource. Original diagnostics hashes still match all5 files; they are absent from this worktree/commit. `v1.0.0` still resolves to29d35d1. No deployment, external scan, paid inference or persistent Research restart.

The Recon implementation is ready for its focused main commit/push. #36 is CLOSED with the successful CI proof above. The next checkpoint must record the Recon runtime SHA and its own remote CI result before marking #7 Milestone3 complete; later milestones and release acceptance remain separate.

The initial history render also triggered16 ESLint `react-hooks/error-boundaries` diagnostics because JSX was inside `try/catch`; only the awaited history lookup is now caught and JSX renders outside. Final lint is clean. These were intermediate development failures, not passing gates or reasons to weaken existing assertions/timeouts.

### Pushed Recon runtime / web CI proof

`9cc544b667052fe8b2ffb15c005ade3a79db42bc` is pushed to origin/main, following the separate CI correction `7faf12e7d1d83f8a2650903b4cf52db3550346ac`. [Web job128375217680](https://github.com/broxcat/bughunter-web/actions/runs/42363044721/job/128375217680) is SUCCESS on the Recon SHA:128 passed files/6 opt-in files skipped,1,726 tests passed/0failed/46 opt-in cases skipped; additive upgrade preservation passed. The29 infrastructure opt-ins and17 network opt-ins run in the successful local suites above. Its sibling native job128375217817 is still pending at this intermediate checkpoint; completion is not inferred from the prior7faf12e run.

### Milestone 3 COMPLETE — integration checkpoint

[Run42363044721](https://github.com/broxcat/bughunter-web/actions/runs/42363044721) is now **SUCCESS** on the exact pushed Recon runtime/test SHA **`9cc544b667052fe8b2ffb15c005ade3a79db42bc`**. Both [web128375217680](https://github.com/broxcat/bughunter-web/actions/runs/42363044721/job/128375217680) and [native128375217817](https://github.com/broxcat/bughunter-web/actions/runs/42363044721/job/128375217817) passed. Native smoke again reports READY,12 fixture entries,46 loopback requests and all4 allowed Nuclei templates. Hosted disk starts at16GiB available, ends the loaded image at7.4GiB and returns to15GiB after exact job-owned cleanup. This second native success confirms #36's correction on the Recon commit; its longer compilation time was not a product/test failure.

All Milestone3 criteria in the evidence table are validated. No remaining Milestone3 blocker. #36 is CLOSED; #7 stays OPEN for Milestones4–8. Global release/fresh-install/production deployment acceptance is not claimed, and no later milestone was started. The historical `v1.0.0` tag and package version remain unchanged.

Commits: CI correction `7faf12e7d1d83f8a2650903b4cf52db3550346ac`; Recon implementation/tests `9cc544b667052fe8b2ffb15c005ade3a79db42bc`; this final checkpoint is documentation-only. `origin/main` was verified at9cc544b before this checkpoint commit. Its `[skip ci]` marker avoids an unnecessary third native build: runtime, tests, workflow and Dockerfile are identical to the green9cc544b SHA. The final documentation SHA and confirmed remote head are recorded in #7 and the delivery report after push.

Clean isolated worktree validation excludes the5 original Research diagnostic WIP files; all5 original SHA256 checks still pass and none of their paths changed in this mission's commits. After fast-forwarding the original `main`, only those pre-existing2 modified/3 untracked files should remain. No force push, branch, PR, production restart/deployment, public scan, inference call, schema/version/tag/release change. Disposable runner resources are removed. Stop after Milestone3.
