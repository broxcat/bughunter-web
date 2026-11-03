> Recon orchestration and the minimal Target interface now follow [Adaptive Target Recon](target-recon-playbooks.md). This document describes the original Scope Asset migration and compatibility model.

# Target → Scope Asset → Recon → Research → Findings

## Product workflow

`/targets/[id]` is the working hub. Configure authorized assets, correct their
suggested Type, set Asset Value, run Recon on an asset, inspect its stages and
observations, download a brief, then open the existing Codex/Claude Research
console. Findings retain their existing evidence-review workflow.

The progression card shows configured assets, completed Recon, started Research
and confirmed Findings. The operational table is ordered Critical, High, Medium,
Low, then normalized asset name. All priority badges include visible text.
`View` expands observations, source IDs, discovered hosts, pipeline and history
inline. The table scrolls independently on narrow screens. Metadata edits and
archive confirmation are inline; there is no additional Hunt page.

`/recon?program=<id>` redirects to the Target Recon tab. `/scopes/[id]`
redirects to the Target Scope tab. The global Scopes screen still supports
adopting historical orphan hosts. New Recon is initiated on a Target asset;
the previous program-wide POST returns HTTP 410. Historical scans, host links
and read APIs remain available. Legacy host scan requests resolve the associated
asset before queuing; the ordinary vulnerability scan infrastructure is retained.

## Existing architecture reused

The business Target is the existing Prisma `BountyProgram`, whose ID appears in
`/targets/[id]`. Prisma `Target` remains the technical host/execution identity;
renaming it would disrupt existing scan, Research and Finding foreign keys.
`Scope`, approved authorization, `matchesHost`, exclusions, tool policy,
guarded HTTP, scan cancellation, BullMQ/outbox, HostDiscovery, ScanLog,
corpus-v1, Findings and evidence review are reused.

Research uses the existing persistent console, provider-specific tmux sessions,
workspace, authorization policy, `ResearchReconSnapshot` and delivery records.
No second Research engine or old Hunt execution was introduced.

## Structured assets

`ScopeAsset` stores `programId`, `originalValue`, `normalizedValue`, `format`,
`type`, `typeSource`, `assetValue`, `active`, creation and modification dates.
The normalized value is unique within the business Target. The original pasted
text is preserved. Type and value are editable. An authorization boundary is
immutable: add a replacement and archive the previous entry to change it.

The deterministic detector removes only document escapes `\*` and `\.` and
trims surrounding whitespace. It never interprets a general regular expression.

| Input | Normalized | Format | Initially suggested Type |
|---|---|---|---|
| `*.vfsevisa.com` | `*.vfsevisa.com` | `WILDCARD_DOMAIN` | Wildcard |
| `\*.vfsevisa.com` | `*.vfsevisa.com` | `WILDCARD_DOMAIN` | Wildcard |
| `www.vfsvisaonline.com` | `www.vfsvisaonline.com` | `SUBDOMAIN` | Web Application |
| `www\.vfsvisaonline.com` | `www.vfsvisaonline.com` | `SUBDOMAIN` | Web Application |
| `https://equatorialguinea-evisa.com` | `https://equatorialguinea-evisa.com/` | `URL` | Web Application |
| `agents.tasheer.com` | `agents.tasheer.com` | `SUBDOMAIN` | Web Application |
| `api.example.com` | `api.example.com` | `SUBDOMAIN` | API |
| `https://portal.example.com:8443/app` | same | `URL` | Web Application |
| `192.0.2.1`, `2001:db8::1` | canonical address | `IP` | Other |
| `192.0.2.0/24`, `2001:db8::/32` | canonical address/prefix | `CIDR` | Other |

Type is a user-controlled functional classification: API, Web Application,
Wildcard or Other. Format is the technical syntax. An `api.*` heuristic is a
suggestion, never a statement about application behavior. Explicit user choices
are marked `USER`; inferred new values `HEURISTIC`; migrated values `BACKFILL`.
Asset Value is user-controlled Critical/High/Medium/Low, default Medium.

The detector uses label count for DOMAIN versus SUBDOMAIN; it does not infer
registrable domains using a public-suffix service. Unicode hostnames require
explicit ASCII/punycode form, matching the existing FQDN engine. Unicode URL
paths are encoded. Invalid hosts, embedded spaces, credentials, URL queries and
fragments, unsupported escapes and ambiguous encoded traversal are rejected.
IP/CIDR and single-label HOSTNAME values are preserved for documentation only:
the existing FQDN execution engines do not authorize their active Recon or
Research (HTTP 422). The UI labels and disables those actions.

## Authorization

Exact domain entries authorize that hostname only. Wildcards use the existing
matcher: `*.example.com` covers matching subdomains, including nested ones,
and does not authorize the apex or neighboring domains. Exclusions always win.
A discovery records evidence and cannot change authorization. Discovered
technical hosts retain their `discoveredFromAssetId` wildcard parent.

A URL asset adds one shared boundary around the existing host engine: exact
scheme, hostname, effective port, selected path and path descendants at segment
boundaries. `/app` includes `/app/users`, not `/application` or `/admin`.
Ambiguous encoded traversal is rejected before URL parsing. A URL entry never
promotes its whole hostname into legacy program scope rules. Multiple paths on
one hostname have separate execution identities and conversations.

The same boundary helper is used by execution, normalization, exported policy,
Burp active/history adapters and the Playwright request hook. URL assets use
the guarded HTTP collector rather than a CLI crawler that might cross the path
boundary. Current asset activity, approval and exclusions are checked before
network work. Queued scans capture immutable type/value/boundary metadata;
revoked authorization cannot be restored by that historical snapshot.

Legacy free-text restrictions remain visible and require review; they are not
automatically converted into broader structured authorization. Global Target
and wildcard Research consoles are passive intelligence consoles. Active
investigation uses a concrete authorized host or URL console. Old ZIP/session
creation refuses new URL/wildcard assets and directs to the persistent console,
so the legacy exporter cannot weaken their boundary.

The existing console authorization lifecycle is retained: stop native agent
network work before changing authorization or archiving an asset. New terminal
tickets and application requests reject revoked scope. Detaching a browser
preserves tmux and does not itself kill autonomous CLI work; scope revocation is
not a new network sandbox around arbitrary shell commands. A changed program
authorization snapshot requires the existing explicit operator workspace-policy
refresh procedure. Metadata-only Type/Value updates instead create a Recon
context update without rewriting the running workspace policy.

## Recon per asset

Each `ScanRun` may reference `scopeAssetId`, immutable `scopeAssetSnapshot` and
derived `assetResults`. Eleven `ReconPipelineStep` records are queued in order:

1. Discovery
2. DNS
3. HTTP probing
4. Ports
5. Technology detection
6. Crawling
7. Endpoint extraction
8. Parameter extraction
9. JavaScript analysis
10. Normalization
11. Research Context

Every stage has Pending/Running/Completed/Skipped/Failed plus dates and a
reason. Failed stages retain useful evidence. The final Research Context stage
is explicitly skipped with an explanation: evidence is ready, while snapshot
generation or refresh remains an explicit Research action. Cancellation and
worker interruption finalize unfinished stages rather than leaving them running.

| Classification / format | Collection plan |
|---|---|
| Wildcard format | Existing subfinder and certificate-transparency discovery on the selected parent; gau historical URLs; bounded DNS/HTTP/TLS/ports/technology/crawl enrichment of authorized discovered hosts |
| Web Application, domain/host | DNS, guarded HTTP/HTTPS probing, TLS, httpx, fixed TCP ports 80/443/8080/8443 through nmap, existing corpus extraction and katana JavaScript-aware crawl |
| API | Existing corpus extraction plus read-only OpenAPI/Swagger/api-docs/GraphQL seeds inside scope; observed authentication challenges, content types and status codes; no host-wide port scan |
| URL, any Type | Exact origin/port/path guarded requests and internal crawl; no external HTTP CLI or host-wide port scan; API documentation seeds if Type is API |
| Other | Generic plan based on the supported format; metadata-only formats remain non-executable |

Format constrains authorization regardless of the editable Type. Changing a
wildcard's Type cannot authorize its apex. Changing a URL's Type cannot expand
its path or enable an unrestricted crawler. No authentication brute force,
GraphQL introspection or automatic destructive method is added.

Limits: eight enriched hosts per wildcard, up to 1,000 archive URLs, 25 retained
HTTP response metadata entries per host, existing bounded corpus/crawl limits
and command deadlines. Additional discoveries remain in original storage and
appear as discovery-only observations; reaching a coverage bound is Partial.
The UI shows the last 20 runs, original logs, duration, discovery count and
stage failure reasons. Errors/bounds never imply complete coverage.

Asset states are Not Started, Queued, Running, Partial, Completed, Failed and
Stale. Only a completed SUCCESS is Completed; after seven days it is Stale.
The underlying historical scan status/outcome is unchanged. Freshness of
individual Research evidence is Recent through seven days, Aging through thirty,
then Stale. These two indicators intentionally describe different things.

## Evidence and Research priority

Supported input formats are the existing persisted corpus-v1, HostDiscovery
sources, bounded recognized plain stdout from httpx/katana/nmap and DNS logs,
and the new validated assetResults-v1: per-host corpus, DNS addresses, real
HTTP GET status/content type, authentication challenge schemes, redirects,
TCP port observations, TLS fingerprint/validity and gau archive URLs.
Original scan rows/logs/corpus are preserved. No undocumented scanner JSON
format is assumed. Raw bodies, cookies, credentials, titles and arbitrary
metadata are not copied into the derived evidence.

Per-host derivatives retain the real scan ID and original field references;
inventory discoveries are kept even when their host was not enriched. An archive
URL is historical discovery with unknown live accessibility and unknown original
observation date. Collection time is recorded without claiming live verification.
Equivalent observations merge first/last dates and source references. Out-of-scope
or historical evidence remains traceable and is excluded from active suggestions.
Technology signatures are inferred names, with no invented confirmed version.

Research first sorts by user Asset Value, then deterministic signal scores:

| Signal | Score |
|---|---:|
| Administrative route name | +30 |
| API route | +20 |
| Observed HTTP authentication challenge | +20 |
| Observed parameter names | +15 |
| Authenticated crawl | +10 |
| Newly present versus previous retained complete corpus | +10 |
| Aging endpoint evidence | −10 |
| Technology signature or observed open TCP port | 15, or 5 when aging |

Each suggestion has a fixed explanation, observation IDs, scan sources, LOW
confidence, freshness, scope ID and available asset type/value/ID. Names and
signals are hypotheses for review, never vulnerability proof. Authentication
challenge and authenticated crawling do not establish correct access control.
Coverage differences may explain scan changes. Stale, historical, unsafe-action
or out-of-scope endpoints are excluded from suggestions.

Snapshots reuse the existing `ResearchReconSnapshot` schema and versioned JSON
contract with additive `scopeAssets` metadata. Both providers receive identical
immutable detail/summary files and a compact fixed transport instruction.
Snapshots are capped at 1 MiB; prompt summaries at 24 KiB, with at most twelve
summary endpoints and twenty suggestions. Detail pagination remains available.
Up to sixty scans, 500 discoveries and 1,000 bounded log rows per scan are read;
truncation is explicit.

Focused child Research can reuse compatible same-Target parent/wider-scope
Recon, including archived source assets as historical evidence. The destination
asset still determines authorization. This allows using prior wildcard findings
without rerunning Recon. A new scan or metadata edit changes the fingerprint;
Research displays an available update and requires explicit refresh. Previous
snapshots and per-provider delivery records remain immutable. No running
conversation is silently replaced, and persistent provider/MCP configurations
are not rewritten to inject Recon.

## Downloadable scope.md

Authenticated, owner-checked routes:

```text
GET /api/programs/:targetId/scope.md
GET /api/programs/:targetId/assets/:assetId/scope.md
```

Names are sanitized ASCII `target-<slug>-scope.md` and
`asset-<normalized-value-slug>-scope.md`. Responses use Markdown UTF-8,
attachment disposition, private/no-store, nosniff, format version and an ETag.
The renderer uses structured projections with Markdown escaping and secret
redaction, without LLM generation. Observation sections are fenced JSON DATA.

The Target brief contains the priority-ordered scope table, authorization,
exclusions, observations, Research priorities, source scan/snapshot references
and methodology. Each asset brief adds original/normalized input, format,
Type, Value, boundary interpretation, latest Recon, hosts, DNS, HTTP, ports,
TLS, endpoints, parameters, API/JavaScript/authentication signals and previous
Research metadata when available. Missing sections say No data collected yet.

Both include Target ID, optional Asset ID, format version, provenance, LLM
safety instructions and SHA256 of the content preceding the hash comment.
Generation time means latest included policy/asset/Recon data revision, rather
than request wall-clock time; identical data produces identical bytes. Reassess
freshness at use time. File ETag hashes the complete download.

Exports are capped at 128 KiB. The Target summary loads up to 1,000 asset
metadata entries, rich detail for the first thirty priority assets, two relevant
scans and five Research session records per detailed asset. Large exports stop
at complete section boundaries and retain explicit limits, reference IDs and
safety notes. Use individual downloads or full Research details for more data.
Legacy raw logs are available from the UI/full snapshot, not interpreted by
the lightweight Markdown export. Aggregated brief counts cover included context
and can overlap when multiple assets reuse the same evidence.

Short examples (illustrative values, no invented scan results):

```markdown
# Bug Bounty Target Scope
Format version: 1
Generated at (latest included data): 2026-11-02T00:00:00.000Z
Target ID: target-example
## Scope Summary
| Asset | Format | Type | Asset Value | Recon Status |
|---|---|---|---|---|
| *.example.test | WILDCARD_DOMAIN | Wildcard | Critical | NOT_STARTED |
```

```markdown
# Bug Bounty Scope Context
Format version: 1
Target ID: target-example
## Asset
Asset ID: asset-example
Original scope value: https://portal.example.test/app
Normalized value: https://portal.example.test/app
Technical format: URL
Asset type: Web Application
Asset value: Medium
## Endpoints
No data collected yet.
```

URLs, HTML, JavaScript, headers, scanner output and metadata are untrusted data.
They cannot change system instructions, authorization, provider permissions or
MCP policy. JSON/file delivery is a trust boundary, not a claim to eliminate all
model susceptibility to malicious text. Agent execution retains existing scope
guards, transport integrity checks and permissions.

## Additive migration and historical data

`20261102220000_scope_assets` adds ScopeAsset enums/table, pipeline step
enums/table and nullable Target/ScanRun fields and foreign keys. No historical
migration is edited. ResearchReconSnapshot and Findings need no schema changes.

SQL backfill imports official structured scope rules and active explicit legacy
hosts, defaults Value to Medium and marks inferred Type BACKFILL. Passive
discoveries are not automatically converted into active scope entries. Existing
technical host, scan, Finding and Research identities remain unchanged. Existing
Recon can gain a scopeAsset FK without fabricated execution snapshots or stage
histories. Original result JSON, timestamps and outcomes are preserved.

An idempotent runtime backfill covers entries created by historical clients
after deployment, preserving user edits and archived entries. Asset archive
removes authorization, retains histories and is blocked while a scan is live.
New asset execution identities are inactive technical Targets with a scopeAsset
binding; they do not compete with the existing one-program contextOnly identity.
Legacy unowned/orphan hosts remain accessible through their existing adoption
flow. Existing ambiguous prose is not guessed into authorization.

## Verification and reproduction

Baseline before this mission: `npm test` 583 passed, 155 optional tests skipped.
The implementation adds detection/boundary/status/policy tests, controlled
collector tests, normalization/provenance/archive tests, deterministic/bounded
Markdown tests, SQL CRUD/backfill/queue/snapshot/ownership tests and a browser
workflow. Controlled collector and browser synthetic rows are explicitly marked;
they are not presented as actual scanner execution.

```sh
npm test
npm run lint
npm run typecheck
npm run build
npx prisma validate
npx prisma generate
npm audit
npm run test:queue -- --target-browser
npm run test:network
npm run test:targets:recon
npm run test:research:recon
npm run test:research:mcp-rebuild
```

`npm run test:ui` builds and runs the disposable SQL/Redis/Target-browser harness.
`test:queue` also tests additive historical upgrade and schema↔migration parity
against a disposable shadow database. `test:network` enables actual installed
scanner HTTP tests. `test:targets:recon` starts a Docker-only local target and
executes actual queue/worker API and Web Application asset plans, httpx/nmap/
katana, verifies required UA and URL path isolation. Its app image defaults to
`bughunter-web`, overridable with `RESEARCH_TEST_APP_IMAGE`; sources and matching
Prisma client are mounted for the test. No production DB or application secrets
are mounted. The script removes only containers/network it created.

`test:research:recon` verifies installed native CLI interfaces and real tmux
bracketed-paste transport in a networkless disposable container; it does not run
model inference. `test:research:mcp-rebuild` exercises actual Codex/Claude MCP
connections, Burp outage/recovery, image rebuild/restart and persisted artifacts.
Run the latter when there are no active user provider/tmux sessions. Browser
screenshots are written to `/tmp/bughunter-target-assets-{desktop,mobile}.png`.

Real external wildcard services/programs and logged-in model investigations are
not exercised by these local tests. The example production domains above were
used only as detector inputs, not contacted. Authentication collection observes
public challenge schemes/forms, without automatic login. Historical URLs never
establish current reachability. npm audit currently reports the existing sixteen
moderate development-toolchain advisories and no high/critical advisories;
dependency versions were not changed by this mission.

## Deployment

A Prisma migration is required before the new application version serves
traffic. Rebuild `web`, `worker` (shared app image) and `research-console`
(the shared boundary helper and adapter changes). PostgreSQL/Redis volumes and
the Burp service/configuration are retained. No production application migration
or web/worker rollout is performed by the disposable tests. Schedule the console
restart when user sessions are idle.

With the existing `.env`, healthy db/redis and required bind mounts configured:

```sh
docker compose build web worker research-console
docker compose run --rm --no-deps web npx prisma migrate deploy
docker compose up -d --no-deps web worker research-console
docker compose exec web npx prisma migrate status
docker compose ps web worker research-console
```

For a non-Docker application, use `npx prisma migrate deploy` with the intended
database URL and rebuild/restart the web/worker through the normal operator
process. Never use migrate reset, rewrite historical migrations or delete data
volumes to apply this change.

## Implementation file inventory

Final local validation on 2026-11-02:

| Check | Result |
|---|---|
| `npm test` | PASS: 631 passed, 164 optional infrastructure/network tests skipped |
| PostgreSQL/Redis + Target browser harness (`npm run test:ui`) | PASS: 789 tests, historical upgrade, shadow-schema parity, desktop/mobile browser workflow; six network tests disabled here |
| `npm run test:network` | PASS: all six actual local HTTP/scanner tests |
| Prisma validate/generate, lint, typecheck, production build | PASS |
| `npm run test:targets:recon` equivalent runner | PASS: actual queue/worker and installed httpx/nmap/katana against a Docker-local fixture; API and Web Application paths |
| `npm run test:research:recon` | PASS: native Codex/Claude interfaces and real tmux transport, no model inference |
| `npm run test:research:console` with current-source test images | PASS: providers, browser, clipboard, scope revocation, reconnect, official-protocol fixture, actual proxy/browser boundary, asset Recon inventory, deletion/cancellation and restart persistence |
| `tests/research/runInfrastructure.mjs` | PASS: historical workspace/SSH/validator/permissions and fixture MCP transport |
| `npm run test:research:mcp-rebuild` | PASS: native Codex/Claude and real Burp, outage/recovery, rebuild and persisted artifacts |
| `npm audit` | FAIL: sixteen pre-existing moderate development-toolchain advisories, zero high/critical |
| Authenticated model inference, real external wildcard enumeration, production web/worker migration/rollout | NOT TESTED / not performed |

The console acceptance fixture needs a 2,048-process test budget because it runs
multiple native CLI workspaces and diagnostic probes concurrently. The production
process budget is unchanged. Earlier fixture runs exposed that limit and obsolete
expectations for MCP status/Target selectors; the harness was updated and the
complete run passed. These are isolated fixture results, not logged-in model
investigations. The Target confirmed-Findings indicator currently uses the latest
1,000 owned Finding rows; use the existing Finding views for larger inventories.

The mission changes these files; pre-existing provider-diagnostics edits are
excluded from its commit. Existing tests are updated where the Target UI or
asset-bound queue contract replaces the former program-wide Recon path.

- `README.md`
- `docker/research/Dockerfile`
- `docker/research/validator/burp-active.mjs`
- `docker/research/validator/burp-http.mjs`
- `docker/research/validator/playwright-launch.mjs`
- `docker/research/validator/playwright-scope.cjs`
- `docs/target-recon-workflow.md`
- `package.json`
- `prisma/migrations/20261102220000_scope_assets/migration.sql`
- `prisma/schema.prisma`
- `src/app/(dashboard)/hosts/[id]/page.tsx`
- `src/app/(dashboard)/layout.tsx`
- `src/app/(dashboard)/recon/page.tsx`
- `src/app/(dashboard)/scopes/[id]/page.tsx`
- `src/app/(dashboard)/targets/[id]/page.tsx`
- `src/app/(dashboard)/targets/page.tsx`
- `src/app/api/findings/route.ts`
- `src/app/api/programs/[id]/assets/[assetId]/recon/route.ts`
- `src/app/api/programs/[id]/assets/[assetId]/research/route.ts`
- `src/app/api/programs/[id]/assets/[assetId]/route.ts`
- `src/app/api/programs/[id]/assets/[assetId]/scope.md/route.ts`
- `src/app/api/programs/[id]/assets/route.ts`
- `src/app/api/programs/[id]/recon/route.ts`
- `src/app/api/programs/[id]/route.ts`
- `src/app/api/programs/[id]/scope.md/route.ts`
- `src/app/api/programs/route.ts`
- `src/app/api/scan-runs/route.ts`
- `src/components/ProgramForm.tsx`
- `src/components/ProgramWorkflow.tsx`
- `src/components/ResearchReconContext.tsx`
- `src/components/ScanStart.tsx`
- `src/lib/reconPipeline.ts`
- `src/lib/research/consolePolicy.ts`
- `src/lib/research/recon.ts`
- `src/lib/scopeAssets.ts`
- `src/server/execution.ts`
- `src/server/queue/executionAttempts.ts`
- `src/server/queue/processScan.ts`
- `src/server/queue/scanCancellation.ts`
- `src/server/queue/scanRequest.ts`
- `src/server/recon/assetEvidence.ts`
- `src/server/recon/assetPipeline.ts`
- `src/server/recon/program.ts`
- `src/server/research/consoleWorkspace.ts`
- `src/server/research/reconContext.ts`
- `src/server/research/reconInputs.ts`
- `src/server/research/reconSnapshots.ts`
- `src/server/research/sessions.ts`
- `src/server/research/workspace.ts`
- `src/server/scanners/discovery.ts`
- `src/server/scanners/http.ts`
- `src/server/scanners/recon.ts`
- `src/server/scanners/toolPolicy.ts`
- `src/server/scopeAssets.ts`
- `src/server/scopeMarkdown.ts`
- `tests/e2e/targetAssetWorkflow.mjs`
- `tests/e2e/targetWorkflow.mjs`
- `tests/integration/programWorkflow.test.ts`
- `tests/integration/scopeAssets.test.ts`
- `tests/migrations/programUpgrade.mjs`
- `tests/queue/runInfrastructure.mjs`
- `tests/recon/assetTools.mts`
- `tests/recon/runAssetTools.mjs`
- `tests/research/holdProgramRecon.mts`
- `tests/research/runConsole.mjs`
- `tests/research/runInfrastructure.mjs`
- `tests/unit/assetPipeline.test.ts`
- `tests/unit/assetReconInputs.test.ts`
- `tests/unit/discoveryResult.test.ts`
- `tests/unit/scanWorker.test.ts`
- `tests/unit/scopeAssets.test.ts`
- `tests/unit/scopeMarkdown.test.ts`
- `tsconfig.json`
