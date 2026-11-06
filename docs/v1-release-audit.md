# BugHunter Web v1.0.0 — final release-candidate validation

## Final release decision: PASS

The release candidate closes all required v1.0.0 gates. Version is `1.0.0`, sourced only from `package.json` through `src/lib/buildVersion.ts`; no React version literal was added. Publication is allowed only for the exact release commit after its post-commit lint, type generation, TypeScript, build and affected browser checks pass. Tag `v1.0.0` must resolve to that commit. This section supersedes the earlier conditional decision preserved below.

### Authenticated Claude acceptance — PASS

- Actual host Claude CLI: `2.1.318`; real authenticated model: `claude-opus-5-5`.
- Existing current Research workspace: scope approved, owner checks passed, captured authorization matched current policy and a real Research Plan was linked.
- Native Read successfully accessed the actual workspace AGENTS, scope, plan Markdown/JSON and current Coverage pointer/snapshots (seven reads). No synthetic context, mock response, MCP discovery or unauthenticated initialization was used as inference proof.
- `alreadyCovered = NONE_RECORDED`; `oneUntestedObjective = cmw4ze1do00lmnt0ui5rfsw1t`, verified against a real READY, untested plan item.
- `coverageProvesSafety = false`, `networkActions = 0`, `workspaceMutations = 0`; complete workspace hashes/metadata were unchanged. Only Read and the native StructuredOutput response protocol were used.
- Authenticated inference completed successfully in 11,925 ms. Authentication used the existing local OAuth login. An inherited environment API key was rejected during preflight; it was excluded only from the acceptance subprocess so the existing OAuth login could be used. No credential was printed, copied to BugHunter or persisted by the acceptance scripts. Product AI routing/configuration did not change.

### Fresh installation — PASS

The current local PostgreSQL database is a **fresh installation**: the earlier local volume was recreated after a host disk-full incident. This was not an application migration event. The earlier 437 historical rows are **not claimed to exist in this database**.

`docker compose exec -T web npx prisma migrate status` reports all 37 migrations applied and the schema up to date. Required services are running, PostgreSQL/Redis/Burp/Research services are healthy, and HTTP health reports DB/Redis up. Actual browser credentials login passed. A temporary acceptance account and minimal Target/Scope Asset were used to verify Targets, Scope, Research and Findings, then removed without changing existing users' data. No Recon scan or unnecessary historical fixture was created. The same login/core-UI/footer smoke is required after deploying the tagged release.

### Disposable upgrade — PASS

The documented infrastructure runner provisioned its own PostgreSQL/Redis resources, executed `npm run test:migration` from the old schema through `prisma migrate deploy`, preserved historical fixture identities/evidence/snapshots and detected **no schema drift**. It never used the current application database. The earlier 437-row/17-table historical-preservation audit remains documentary evidence of the prior installation, preserved in the earlier section below; it is separate from this fresh-install acceptance.

### Exact test results

| Check | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Full `npm test` with disposable PostgreSQL/Redis | 1,368 | 0 | 17 opt-in network cases |
| `npm run test:network` | 17 | 0 | 0 |
| Distinct executed Vitest cases | **1,385** | **0** | **0 unexecuted** |

The full infrastructure run also passed Target browser, Research browser, auth/browser login and Redis loss/restart, queue resilience, migration and drift checks. Additional current runs passed Coverage/Vault/history/lifecycle/Retest browser, Research Plan browser, Black-box UX (10 checks), native Research infrastructure and real Research console/Burp HTTP/1.1 + HTTP/2, refresh, reconnect, archive and deletion. Real Burp used local fixture targets, not public scans. Native Codex infrastructure/MCP checks did not perform another paid Codex inference; the unchanged, documented real Codex acceptance remains valid. The unchanged real Gemini/Ollama synthesis acceptances remain recorded below.

`npm run lint`, `npx next typegen`, `npx tsc --noEmit`, `npm run build`, `docker compose config --quiet` and `git diff --check` passed in an isolated checkout excluding the five unrelated local Research diagnostics files. The two Research test harnesses now stop their disposable Compose projects without `down -v`; cleanup individually verifies project labels before removing only their own volumes. No application volume was removed.

### Dependencies — ACCEPTED_DEV_TOOLING_RISK

- Production audit (`npm audit --omit=dev`): **0 vulnerabilities**.
- Complete audit: **8 moderate**, **0 high**, **0 critical**, all in the ESLint/TypeScript-ESLint development chain through minimatch `10.2.6`.
- Installed ESLint: `9.39.5`; `eslint-config-next`: `16.4.2`; TypeScript-ESLint: `8.72.0`.
- Registry verification found latest TypeScript-ESLint patch `8.72.1` still depends on minimatch `^10.2.2`; the latest published minimatch 10 version remains `10.2.6`. The fixed minimatch `11.0.1` is outside that supported range. No compatible patch/minor or supported narrow override is available. No forced audit fix, unsupported major override, Next downgrade or blind lockfile refresh was applied.
- No production source imports minimatch or exposes attacker-controlled runtime patterns to this lint dependency. The moderate development tooling risk is explicitly accepted for this release; production advisories remain zero. See the maintainer advisory linked in the earlier audit.

### Release gate matrix

| Required gate | Decision |
| --- | --- |
| Authenticated Claude inference | PASS |
| Fresh install | PASS |
| Disposable upgrade / no drift / fixture preservation | PASS |
| Targets / authoritative Scope | PASS |
| Recon / Authenticated Recon / AI synthesis | PASS |
| Research Plan / Research Coverage / Research | PASS |
| Evidence / Findings / Retest / Report | PASS |
| Security boundaries | PASS |
| Required tests | 0 failures |
| Production dependencies | 0 vulnerabilities |
| Known BLOCKER defects | 0 |
| Known HIGH functional defects | 0 |

The repository had no open issues at release inspection. No new product feature, provider architecture, scanner or migration was introduced during release finalization. The only test changes enforce safe disposable-volume cleanup. Release publication and deployment must follow the exact validated commit/tag; runtime version and actual browser login are checked after deployment.

---

## Earlier stabilization audit — before local PostgreSQL recreation

The remainder is the original historical audit. Its `0.1.0` version, conditional Claude status, then-current data counts and deployment statements describe that earlier installation only and are superseded by the final decision above.

### Stabilization evidence recorded 2026-11-06

The five delivery stages have been executed through the audit. The application remains version **0.1.0**. No v1.0.0 tag or release was created. The footer reads the build version from `package.json` through `src/lib/buildVersion.ts`.

Executable workflow checks passed in the available environment. **Authenticated Claude model inference remains NOT TESTED because its CLI is not authenticated.** Its native terminal, persistence, reconnect, MCP initialization and passive relay were tested. This document does not certify that missing inference acceptance or authorize a v1.0.0 release. Continue the stabilization freeze until the remaining acceptance and release review are complete.

## Delivered stages

| Stage | Commit | Result |
| --- | --- | --- |
| Research Coverage | `8c38868` | Persistent dimensions, revision history and negative results; independent methods/actions/account comparisons; identical Codex/Claude input; explicit structured recording/import only |
| Minimal Evidence Vault | `f909179` | Durable EV IDs, reference-only Recon/workspace provenance, safe hashes, redacted explicit HTTP metadata, supports/refutes/context links through Hypothesis, Finding, Coverage and Report |
| Recon history and diffs | `963a99c` | Durable surfaces and distinct run memberships; actual first/last seen; new/changed/not observed/unchanged; manual A/B comparisons; matching changes can flag NEEDS_RETEST without claiming a test |
| Finding lifecycle and Retest | `7a07b2c` | Explicit human validation, submission metadata/history, immutable retest results and original/new proof identities; historical Report distinctions |
| Audit fixes | `28ca3e0` | Historical evidence privacy, transactional Report eligibility, Program Report flow, retired-mode notices and uncaptured-mode compatibility, reproducible fixtures, package-derived development version |

Scope stays authoritative. Discovery and a plan never authorize a host. Coverage is not a Finding or a declaration of safety. New Findings remain CANDIDATE until explicit human review and validation. Authenticated external Recon remains Black-box. No scanner, Default Provider routing, model selection, source ingestion, Research provider architecture or Burp integration was redesigned.

The Vault currently supports HTTP_REQUEST_RESPONSE, RECON_ARTIFACT, BURP_REFERENCE and RESEARCH_EVIDENCE. Other proposed file/media kinds are not advertised. Recon scheduling remains manual; durable comparisons are implemented.

## Workflow regression

| Area | Result | Evidence and practical limit |
| --- | --- | --- |
| Targets | PASS | Real UI creation, inline edits, policy/User-Agent, ownership, deletion, upgrade and mobile fixtures |
| Scope | PASS | Domain/subdomain/URL/wildcard/IP/CIDR boundaries, exclusions, path boundaries, revocation, redirects and isolation; IP/CIDR remain documentary where the existing execution engine does not support them |
| Recon | PASS | Nine real installed-tool Format/Type/Value cases; soft-404/content providers/budgets/artifacts; queue cancellation/crash/recovery; no public scan in these fixtures |
| Authenticated Recon | PASS | Actual cookie/session/bearer requests, anonymous and two-account differentials, remote session loss, browser metadata/privacy; five Black-box mapping cases; 90 requests in the native/browser fixture with zero foreign redirects or action requests |
| Research Plan | PASS | Deterministic SQL/API/browser generation without AI; immutable session plan after later Recon; rejected hypotheses retained; historical White-box metadata readable, zero source-locator requests; all new plans Black-box with empty source signals/references |
| Coverage | PASS | GET/PATCH and Anonymous/A→B separation, negative history, refresh, import replay, persistent context and safe scope revocation; no terminal transcript inference |
| Research | PASS with conditional limit | Real Codex inference reads common Coverage, avoids repeated GET, identifies PATCH as untested and proposed next method; no network/test execution. Native Codex/Claude PTYs, tmux, reconnect/archive/delete and MCP pass. Claude authenticated inference unavailable |
| Evidence | PASS | Actual SQL/file/reference provenance, hashes, redaction, owner isolation, symlink refusal, shared IDs through human promotion and Report; source content is not copied |
| Findings | PASS | Manual Candidate and human Hypothesis promotion, independent Evidence Review, explicit validation checks, rejected/inconclusive paths, CVSS/CWE, lifecycle revision/idempotence, manual submission metadata |
| Report | PASS | Confirmed review plus eligible validated new lifecycle; legacy uncaptured compatibility; concurrent review change cannot slip through; Program and technical Target flows; same proof IDs after refresh |
| Retest | PASS | Original proof retained; new dated session/evidence result; all four outcomes; no overwrite or automatic confirmation; unresolved outcomes cannot close as confirmed fixes |
| Upgrade | PASS | Disposable old-schema upgrade and drift check, then actual installation migration and historical hash comparison |
| Security | PASS for checked boundaries | Ownership/scope, credential redaction, SSRF/redirect fixtures, safe workspace access and Research/Docker isolation. Dependency tooling exception is recorded below |

Browser evidence is labelled synthetic where applicable. Actual scanner binaries, actual PostgreSQL/Redis, actual native CLIs, actual Burp, and actual model inference are distinguished from fixture observations. These are controlled tests, not a claim of exhaustive vulnerability coverage.

## Real AI synthesis

Provider routing and strict application validation were preserved. No provider fallback or Settings change occurred.

The previously demonstrated transport A/B was: plain chat 200; minimal structured schema 200; minimal array both with and without maxItems 200; complete Recon schema 400/INVALID_ARGUMENT; the same complete schema with only maxItems removed 200. This demonstrates the complete-schema transport incompatibility, not a universal rejection of maxItems. The existing Gemini-specific transport simplification remains isolated from strict application validation. No new diagnostic matrix or arbitrary constraint removal was introduced in this stage.

Current real-model acceptance used retained real Recon evidence, with private exports and no prompt/provider-body logging. The private clone additionally produced VALID Scope and Target reports. Actual installation results after upgrade:

| Surface/provider | Model | Prompt | HTTP | Narrative | Facts / static assets | Citations | Duration |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Scope / OPENROUTER | google/gemini-3.6-flash | recon-report/3 | 200, 200 | RECOVERED | 51 / 23 | 3 references, 1 unique | 31,876 ms |
| Target / OPENROUTER | google/gemini-3.6-flash | recon-report/3 | 200 | VALID | 132 / 54 | 6 references, 2 unique | 17,755 ms |
| Local OLLAMA baseline | gpt-oss:20b | recon-report/3 | 500, then 200 | VALID | same retained Scope input | 32 references, 1 unique | 43,004 ms |

The Scope recovery discarded unsupported accessibility interpretations after application validation. It is RECOVERED, not FACTUAL_ONLY. The local model's first response rejects the optional thinking control; the existing classified, bounded retry uses the same provider/model without that control. No silent provider switch occurred.

The production browser showed **READY_WITH_WARNINGS** for Scope and **READY** for Target. It verified 33 and 88 useful rendered factual rows respectively, zero empty primary lines, summarized static assets, and no “AI synthesis is unavailable” message. Browser-origin isolation allowed zero external browser requests. Screenshots remain private local audit artifacts.

This audit used seven OpenRouter chat requests: four in isolated real-evidence acceptances, three on the actual installation. No scanner was rerun for production synthesis. Historical Summary rows were retained and two new rows were added.

The real Codex Coverage acceptance used the product's existing non-root container/`--yolo` mode, with synthetic files and no target execution. It read the input files successfully, returned `repeatGet=false`, `plannedNextMethod=PATCH`, `untestedMethods=[PATCH]`, `executeNow=false`, and `coverageProvesSafety=false`. Initial harness attempts used a nested read-only sandbox unsupported by this container's namespace policy; the final acceptance uses the actual supported product mode. No host permission or kernel change was made.

## Exact test results

| Check | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Full Vitest with disposable PostgreSQL/Redis | 1,368 | 0 | 17 opt-in network cases |
| Explicit network suite | 17 | 0 | 0 |
| Distinct Vitest cases across those runs | **1,385** | **0** | **0 unexecuted** |

The full infrastructure run also passed old-schema migration, schema drift, Target browser, Research browser and authentication/Redis-loss browser tests. Separate successful harnesses covered Coverage/Vault/lifecycle/history, Research Plan, Black-box UX (10 checks), native authenticated Recon, five-case authenticated mapping, native Research isolation and real console/Burp. Native toolchain acceptance covered nine cases. Real production browser covered both Summary surfaces.

`npm run lint`, `npx next typegen`, `npx tsc --noEmit`, `npm run build`, Docker app-image build, `docker compose config --quiet` and `git diff --check` passed. Redis loss/restart, worker interruption/restart, cancellation, timeouts, browser refresh and Research reconnect were exercised in disposable infrastructure.

**Not tested: 1 conditional capability — authenticated Claude model inference.** Native Claude/MCP fixtures are not counted as that acceptance. Scheduling and unsupported Vault kinds are outside the delivered feature set.

Production dependency audit reports zero advisories with `--omit=dev`. The complete install reports eight moderate entries in the ESLint/TypeScript-ESLint dependency chain from one minimatch advisory, zero high/critical. No public runtime pattern input/import was found for that lint dependency. Remediation remains a tooling follow-up; npm's suggested Next lint-config major downgrade was not applied blindly. The maintainer describes amplification for attacker-controlled patterns with optimizationLevel ≥2: [GHSA-g3hv-75wg-m249](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249).

## Migrations and actual deployment

Four additive migrations were introduced:

- `20261106120000_research_coverage`
- `20261106130000_evidence_vault`
- `20261106140000_recon_surface_history`
- `20261106150000_finding_lifecycle_retest`

No historical data/table/enum/snapshot was dropped or rewritten. Existing Findings retain null lifecycle; no past coverage, Vault evidence or retest was invented. The already deployed Black-box retirement migration remains intact.

Before deployment there were zero active Recon scans, zero current White-box Programs and zero active assessment sources. The app-only image was rebuilt for web/worker from the committed source, preserving the existing scanner/dependency toolchain. The Research console image was not rebuilt: its embedded contracts did not change. The five preexisting local Research diagnostics files were excluded and preserved.

Prisma migrate deploy succeeded on the actual installation. Web and worker were recreated; DB/Redis/Burp/Research volumes and services were retained. Health returned HTTP 200 with DB and Redis up. After migration and real synthesis, **437 original rows across 17 tables retained identical hashes**, with zero missing/changed rows and two additional Recon Summary rows. All 22 historical Findings retain null lifecycle. Coverage, Vault and retest tables remain empty until explicit real researcher events; seven historical terminal Recon runs were indexed documentarily without network execution.

The runtime app image records code revision `28ca3e0`. The complete code delivery was pushed to `origin/main` without force; this audit document is committed separately. No v1.0.0 release was created.
