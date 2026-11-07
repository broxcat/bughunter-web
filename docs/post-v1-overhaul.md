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
