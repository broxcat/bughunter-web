# Recon methodology v2

BugHunter orchestrates authorized discovery, mapping and attack-surface intelligence. It does not exploit findings. The Target/Scope UI remains a compact workflow and console; internal detail lives in structured evidence, coverage, deterministic scope.md and the Summary modal.

## References actually studied

Methodology references, not runtime permissions or copied scanner scripts:

- [Claude-BugHunter](https://github.com/elementalsouls/Claude-BugHunter): `skills/bb-methodology/SKILL.md`, `osint-methodology`, `web2-recon`, `recon-scope-triage`, `triage-validation`. Recon → Map → Find → Prove → Report, Wide/Deep, provenance, typed relationships, negative controls, ownership triage and observation/hypothesis/impact separation. Finding validity gates remain in later manual phases. Brand collisions, hygiene and status codes do not prove bug-bounty vulnerabilities.
- [Claude-Red](https://github.com/SnailSploit/Claude-Red): `Skills/recon/offensive-osint-methodology/SKILL.md`, `offensive-osint`, `Skills/api/offensive-api-security/SKILL.md`, `Skills/fuzzing/offensive-fuzzing/SKILL.md`, `Skills/infrastructure/offensive-advanced-redteam/SKILL.md`. Reproducible runs, time/hash/tool provenance, ROE, coverage and observed API mapping; offensive exploitation/escalation parts are excluded.
- [security-skills / pentest-ai-agents](https://github.com/reason-machines/security-skills/blob/main/skills/pentest-ai-agents/SKILL.md): doctor, advisory/execution separation, bounded parsing and session handoff.
- [OWASP WSTG Information Gathering](https://github.com/OWASP/wstg/tree/master/document/4-Web_Application_Security_Testing/01-Information_Gathering), especially [WSTG-INFO-06](https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/01-Information_Gathering/06-Identify_Application_Entry_Points.md): inventory URL/method/parameters/auth context/TLS/proxy references before tests. No forms are submitted by Recon.
- [PTES Intelligence Gathering](https://pentest-standard.readthedocs.io/en/latest/intelligence_gathering.html) and [Reporting](https://pentest-standard.readthedocs.io/en/latest/reporting.html), also read from the primary [source](https://github.com/pentest-standard/docs): OSINT may be incomplete/stale; adjacent discoveries need explicit scope; professional reports document objectives, methods, coverage and limitations. The main PTES website timed out during review.
- [NIST SP 800-115](https://csrc.nist.gov/pubs/sp/800/115/final): assessment planning/authorization, identification vs validation, operational limits, analysis and reporting.

## Architecture

`Planner → Capabilities → Providers → Fallbacks → ReconArtifact → Intelligence → scope.md → Ollama Recon Report → explicit Research handoff`.

Plans retain version 2 compatibility and add `methodologyVersion: 2`, `strategy`, and capability objectives. Existing 12 stage identities remain readable. A phase groups capabilities; its structured `details` records each provider attempted/selected, errors, fallback, duration, artifacts and coverage impact. Calibration precedes content enumeration; mapping follows it. Post-Recon factual Markdown/report generation remains independent of scanner execution and never starts a provider console.

The primary decision is required coverage, not binary exit codes. Authorization, applicable DNS/HTTP availability, calibrated content inventory, entry-point mapping and normalization/intelligence have explicit objectives. Wildcards require two independent successful passive sources. Empty passive output without a verifiable completion attestation remains inconclusive; an exit code alone cannot demonstrate external source coverage. Extra passive engines, host service enrichment on web profiles, Nuclei and Burp are optional enrichment; their absence alone cannot fail required coverage. A failed internal transport/CA/temp prerequisite prevents active execution. Every discovered target is rechecked by the existing scope engine; CNAME/IP/URL relationships never grant ownership or authorization.

A deliberate host-selection bound is recorded as a coverage limitation, not a pretend scan of every discovered host. Unselected hosts remain not tested. A budget that interrupts a required objective produces incomplete coverage. Missing results never prove safety or disappearance.

## Plan matrix

New scope entries begin WIDE within their exact authorization boundary; subsequent exact-host/URL investigation can be DEEP. Activity (`PASSIVE`/`ACTIVE`), strategy (`WIDE`/`DEEP`) and effort (`LIGHT`/`STANDARD`/`DEEP`) are independent.

| Format / Type | Strategy and capabilities | Low / Medium / High / Critical |
|---|---|---|
| Wildcard / Wildcard | WIDE, passive union → scope triage → DNS → live host ranking → selected enrichment | LIGHT / STANDARD / DEEP / DEEP, progressively larger bounded host budgets |
| Exact domain / Web | DEEP exact-host DNS/HTTP/content/mapping/TLS; bounded ports | Effort follows value; siblings/apex alternatives are not added |
| Subdomain/hostname / Web | DEEP exact-host web mapping | Same value budgets; no parent enumeration |
| Subdomain/hostname / API | DEEP specs, versioned routes, methods, parameter/auth indicators | API wordlist and mapping; no BOLA/bypass/destructive verbs |
| URL / Web or API | DEEP exact origin, effective port and path descendants | Lower host/request cap; no host-wide Nmap |
| Other | Conservative capabilities supported by actual format | IP/CIDR/single-label formats without executors remain documented only |

Value changes only quotas. Current central RPS is 1/2/2/3, bounded requests 60/240/600/1200 before narrower URL/exact-host caps, and at most two concurrently executing assets. Selected concrete hosts are enriched progressively. No arbitrary 65,535-port sweep or new scanner is introduced.

## Calibration and fallback

Three guarded negative paths collect status, byte length, body SHA256, normalized-content SHA256, content type, title/semantic markers and redirect pattern. Reflected paths/callbacks and labelled nonces/IDs are normalized. Classes: REAL_404, SOFT_404, WILDCARD_REDIRECT, WILDCARD_CONTENT and UNSTABLE_BASELINE. Controls are not endpoint discoveries. Equivalent responses from scanners/crawlers are filtered by the same service. An unstable signature remains a documented uncertainty, not a verified administrative or exposure route.

For `307 /login?callbackUrl=<input>`, Gobuster is unsuitable and recorded SKIPPED with NON_DISCRIMINATING_WILDCARD_RESPONSE. No `--force`, global redirect-status blacklist or unbounded sweep is used. FFUF autocalibration is the fallback. A stable length can be excluded by Gobuster only when a known distinct response demonstrates discrimination. Different redirects and semantic signatures are not collapsed.

LIGHT can prefer Gobuster; STANDARD/DEEP prefer FFUF. A successful primary need not redundantly run a second engine. Fallbacks receive the bounded planned words. If both CLIs are unavailable, the guarded native provider can satisfy content coverage only by actually enumerating the calibrated bounded wordlist; merely observing links is insufficient. Execution zero without the required responses does not satisfy coverage. Transport errors/relay errors are never converted into target endpoint evidence. WAF/rate limiting and exhausted request budgets stop further traffic.

## Failure taxonomy and retries

Central typed reasons distinguish environment (missing binaries/files/resources), incompatible tool/parser, target DNS/network/timeout/WAF/429, expected wildcard behavior and scope/cancellation policy. Each carries retryability, coverage impact, capability, provider and fallback use. Errors are logged and persisted; normalized observations remain intact.

Only safe transient operations can be retried with bounded backoff and current authorization/lease checks. Missing files/flags, soft-404s, deterministic parse failures and scope denial are not retried. Existing worker attempt fencing still prevents unsafe automatic replay of network work after a lost execution lease. A substituted provider may complete coverage while preserving the first provider's failure.

## Recon Doctor / manifest

`npm run recon:doctor` audits executable presence, actual version/compiler/architecture, SHA256, expected flags, dynamic runtime dependencies, curated wordlists/templates/configuration, permissions, CA certificates, private temp storage and a local HTTP transport round trip. Tool states: READY / DEGRADED / INCOMPATIBLE / MISSING. A versioned manifest/fingerprint is captured in `ScanRun.toolManifest`; existing `toolVersions` remains compatible. Resource/binary changes invalidate cached audits. Worker acquisition waits for mandatory internal readiness, and plan-specific providers remain subject to the audit before execution.

Docker runs networkless native acceptance for HTTPX, FFUF, Gobuster, Nmap, local DNS and the four Nuclei templates. CI builds the tools stage. `npm run test:recon:toolchain` repeats native acceptance in the configured scanner image. Passive providers use structured/parser fixtures where external source access cannot be exercised offline.

Nuclei remains 3.11.1. Its [go.mod](https://github.com/projectdiscovery/nuclei/blob/v3.11.1/go.mod) uses Go 1.26 and Sonic 1.15.0, whose AST implementation excludes Go 1.27. A dedicated Go **1.26.10** builder, with verified archive hashes and the October 2026 x509 fix, retains the original dependency graph. A Sonic replacement was considered but changes transitive ABI dependencies; it was unnecessary. The native smoke explicitly rejects a Sonic fallback warning, rather than suppressing stderr.

## Evidence and handoff

ReconArtifact remains the source of truth, with run/tool/time/source references. DNS/CNAME, observed references/calls, parameters, auth/reset routes, services and technologies produce deterministic typed graph edges carrying artifact IDs. IPs/vendor relationships remain documentary. Graphs and current scope states enrich the immutable Research JSON; compact prompts remain bounded. No model or graph expands active scope.

scope.md remains deterministic, versioned and independent of Ollama. It records authorization, captured plan, factual surface, differences, coverage and limitations. New step states/nullable metadata and manifest fields are additive; historical runs/snapshots/summary1 records are preserved.

## Ollama Recon Report

Prompt `recon-report/2` produces a professional reconnaissance narrative, not a finding report. Existing Settings select the only endpoint/model. Authorization/assessment metadata, methodology and coverage are derived deterministically; the model writes cited sections and manual Research focus. The typed factual guard checks exact retained evidence IDs and supplied URLs/IPs/ports/technologies/versions. Unknown facts or unsupported vulnerability claims are rejected. Remote content remains untrusted text, never system instructions or tool permissions. Thinking content is never exposed. When model metadata advertises thinking without valid control values, a bounded `think:false` compatibility trial is used. Only a validated result is cached for that endpoint/model; incompatible decoding can fall back to the model default. A factual correction retains the working mode. The captured input and fingerprint remain immutable; actual mode, validation attempts and latency are recorded separately in report generation metadata.

Preprocessing categorizes artifacts, compacts repeated values with counts/digests/provenance, reduces static noise and then constructs the final input. `/api/show` probes model context/thinking capabilities when available. Runtime context is capped at 32,768 tokens, input uses at most half the window with reserved output/schema/safety margin; byte caps remain conservative. Smaller models use a safe fallback budget. One bounded schema-correction retry is allowed against the same evidence. Timeouts/model errors affect only the report. Target synthesis uses asset reports, scope metadata, normalized statistics, graph relationships and changes rather than scanner logs. Historical `recon-summary/1` remains readable and retains its original prompt version.

## Repeatable local acceptance

```bash
npm run test:recon:toolchain
RESEARCH_TEST_APP_IMAGE=<rebuilt-web-image> npm run test:targets:recon
RESEARCH_TEST_APP_IMAGE=<rebuilt-web-image> RECON_NATIVE_WILDCARD_REDIRECT=1 npm run test:targets:recon
npm run test:queue
```

The second native matrix uses uniform 307 login redirects for nonexistent paths: Gobuster is skipped, actual FFUF autocalibration runs, equivalent redirects are excluded, and required content coverage remains complete. Both matrices use an internal Docker network and dedicated disposable databases; they do not scan public programs. Real Ollama inference acceptance lives in `tests/recon/reportReal.mts`, guarded to a dedicated `summary_real_test` database with a read-only copy of the existing Settings selection. It never runs a scanner or contacts the evidence target. Mock inference is labelled separately.

## Migration and deployment

Additive migration `20261104000000_recon_methodology_v2`: new coverage states, nullable capability/details on ReconPipelineStep and nullable toolManifest on ScanRun. No historical migration is edited; no data reset/backfill is needed.

```bash
git pull --ff-only origin main
docker compose build web worker
docker compose run --rm --no-deps web npx prisma migrate deploy
docker compose up -d --no-deps web worker
```

Research-console, provider authentication, Burp topology and user volumes are unchanged. Do not run the MCP rebuild test when its preflight sees user CLI/tmux sessions. No release/tag is created by this mission.
