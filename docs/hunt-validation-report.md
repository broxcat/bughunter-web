# Qualified technique-driven Hunt validation

Validation date: 2026-10-26. Starting main: `76459386a0be23b2c2446cfe2432070d796b92b2`.
Feature branch: `feat/hunt-policy-readiness`. Production services were not migrated,
restarted or used as scan targets. All HTTP/tool tests used local test servers;
browser workflow tests used disposable PostgreSQL/Redis and no scan worker.

## Delivered implementation

19 capabilities: 18 existing scanner modules plus information disclosure. The
complete original audit matrix is [hunt-current-audit.md](hunt-current-audit.md).
Policy names/aliases, prerequisites and per-family technique counts are documented
in [hunt-readiness.md](hunt-readiness.md). The catalogue has 57 unique descriptors:
42 implemented automatic passive/safe methods, 4 implemented fixed timing methods
requiring explicit per-run approval, and 11 intentionally unsupported methods.
Supported family means some safe coverage exists, not complete exploitation.

All families use one deterministic selection function. Empty qualifying means no
additional restriction; non-qualifying wins. Unsupported names cannot activate a
scanner. Hunt snapshots remain immutable across subsequent Target edits.
Readiness runs before enqueue in UI and again during execution. Missing BOLA
identities, JWT, XML and OAuth conditions produce visible skips, not late surprises.

The runtime shares a sanitized Recon corpus, selects applicable catalogue methods,
accounts for requests before dispatch, enforces active scope on each request, and
persists technique progress/candidate evidence independently of Findings. Only
confirmed evidence with independent controls creates a new Finding. Finding
metadata includes family, techniqueId, prerequisitesUsed, evidenceLevel,
referenceIds and catalogue version. The existing manual reporting gate remains.

## Public references

71 distinct reference URLs were reviewed across OWASP WSTG, OWASP Cheat Sheet
Series, PortSwigger Web Security Academy and official HackTricks source, plus
IETF JWT/OAuth guidance and official Dalfox source where relevant. Every supported
family has all four requested source classes. See the catalogue for individual
links, summaries, safe validation, negative controls and last-reviewed metadata.
HackTricks is methodological community material, not normative authority. No
third-party exploit binary/code or dependency was executed or introduced.

## Safety and false-positive controls

- Auth: status flips are insufficient; compare authenticated protected object,
  anonymous denial, repeat controls, response content/type and catch-all shell.
- IDOR: discovered references are signals; no references means no access finding.
  BOLA requires explicitly distinct test accounts and second-user owned object.
- XSS: sinks and literal reflection are not findings; browser-controlled canary
  execution is required for confirmation. Stored writes remain unsupported.
- SQLi: independent error/boolean controls or approved two-stage multi-sample
  timing with matched controls. A single delay cannot confirm SQLi or CMDI.
- SSTI: two different arithmetic results and inert controls; literal templates
  remain unconfirmed. DOM keywords alone remain Signals.
- CSRF: inventories forms/API methods/cookie flags only. Real state changes are
  unsupported and never implicitly triggered for proof.
- SSRF: only configured operator callback, two correlations; callback behavior is
  Validated, not automatically proof of exploitable SSRF impact. No metadata/LAN
  probes, arbitrary destinations or sensitive-file retrieval.
- CORS: origin matrix and protected response comparisons remain candidates or
  validated behavior until browser/session impact is established.
- JWT: actual token prerequisite; two corrupted-signature controls and anonymous
  denial, no identity modification or key guessing. Tokens are never persisted
  in evidence. OAuth consent/grant calls are not automated.
- XXE/LFI/deserialization/business methods inspect safe observations. No parser
  POSTs/file reads, gadget chains, races, purchases, role/price changes or replay.
- All methods enforce selected host, Target UA, read-only HTTP guard, deadlines,
  request limits and secret-free persisted summaries. Foreign discoveries never
  authorize another host. Scope removal aborts future requests in the same run.

## Tool inventory and User-Agent

Bounded Hunt uses the TypeScript probe and controlled Chromium; it refuses every
external CLI under its request guard. Recon/manual wrappers remain audited:
httpx 1.12.0 (`-H`, no random UA/redirect), Katana 1.8.0 (`-H`, exact FQDN/no redirect),
Nuclei 3.11.1 (`-H`, app-owned HTTP template, no redirects/Interactsh), Dalfox 2.13.0
(`--user-agent`, no BAV/headless/foreign payload sources). Conflicting scanner UA
headers are removed; configured Target UA wins. Chromium overrides every routed
request and blocks foreign hosts, native redirect following, service workers and
WebSockets. DNS resolution and TCP-only Nmap are USER_AGENT_NOT_APPLICABLE.

Dalfox's `--config` previously pointed at commented ProjectDiscovery YAML despite
its JSON parser. It now receives `templates/dalfox-config.json`. Actual Dalfox CLI
smoke asserts no config parse error and exact configured UA at a local HTTP server.
The same suite runs actual Nuclei/httpx/Katana and Chromium captures.

## Credentials and UI

Existing encrypted TargetCredential storage is reused. Purpose and owned-object
metadata are additive; no raw cookie/token/password is returned in readiness.
Explicit session refresh is a user-approved login; Hunt does not silently sign in.
Target detail/edit shows immediate red/amber/green requirements with credential,
second-account, session and OOB links. Hunt shows selected/ready/degraded/blocked
counts, per-family technique/request progress and skip reasons. Advanced shows
control names and public references, not payloads. Evidence labels distinguish
Signal, Candidate, Validated and Confirmed; legacy PROVEN alone is not confirmation.

## Validation results

- Full Vitest: **172 tests passed in 24 suites; zero skipped** with
  `SCANNER_HTTP_TESTS=1` and disposable `TEST_DATABASE_URL` enabled.
- Existing Target browser workflow: passed create/edit/rewards/required UA,
  add/edit/remove/duplicates/wildcards/exclusions, selectors, enqueue and history.
- New Hunt browser workflow: passed preflight requirements, contextual credential
  link, secret-free metadata, default-off approval, per-run approval persistence,
  queue/progress polling, blocked reason and evidence labels, anonymous access
  redirect and 390px mobile layout. Report rendering uses an explicit fixture;
  it does not claim a production target was scanned.
- Local runtime tests cover positive and negative SSTI/SQLi/BOLA/JWT confirmation,
  literal reflections, DOM sinks, no credentials, no destructive requests, actual
  UA capture, scope revocation between requests, redirect confinement, CLI bypass
  rejection, OOB configuration and metadata exclusion, request/body limits.
- Existing auth catch-all, policy alias/ownership, snapshot immutability,
  account-independence, XML/OAuth/JWT readiness, timing jitter, catalogue
  applicability/deduplication and approval tests all pass.
- `npm run lint`: passed. `npx tsc --noEmit`: passed. `npm run build`: passed.
- `docker compose config --quiet`: passed. `git diff --check`: passed.
- Prisma migrate diff against fully migrated disposable PostgreSQL: **no difference**.
- Additive migration upgrade on a separate initially empty database: passed with
  pre-upgrade ScanRun/Finding/Report/ReportItem/credential identities intact; new
  snapshots/reports/corpus/finding metadata null, approvals empty, purpose OTHER.

No old test was skipped or deleted to obtain green results. The former CSRF
implicit-write test was updated to assert refusal of unprepared execution and no
state-changing request. Real network suites were explicitly enabled for validation.

## Additive migrations

- `20261026120000_hunt_policy_snapshot`: immutable nullable ScanRun policy snapshot.
- `20261026130000_hunt_credential_metadata`: credential purpose and owned object URL.
- `20261026150000_hunt_execution_metadata`: scan report/corpus/explicit approvals
  and Finding evidence metadata. Existing relations and history preserved.

## Atomic delivery

Each phase was validated, committed and pushed before the next phase began:

1. `b6ff579` — feat(hunt): honor target qualifying vulnerability policy
2. `f014b5c` — feat(hunt): add vulnerability readiness prerequisites
3. `afc11d9` — feat(targets): show hunt readiness for qualifying vulnerabilities
4. `437fa45` — feat(hunt): add reference-driven hunt technique catalog
5. `fa00eeb` — feat(hunt): execute applicable techniques with validation controls
6. `d6113cd` — feat(hunt): expose readiness techniques and validation states
7. Final tests/documentation commit: `test(hunt): validate qualified technique-driven workflow`.

The final delivery message records the seventh commit and verified origin/main
merge hash. No force push or history rewriting is used.
