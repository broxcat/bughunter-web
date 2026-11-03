# Adaptive Target Recon (format 2)

The working flow is **Scope → Recon → Research → Findings**. `/targets/[id]` is the compact control surface: four progress labels, five Scope Asset columns, Add asset, one Target-wide Recon action, cancellation while running, and Download scope.md. It contains no scanner settings, logs, console or provider/MCP diagnostics. Target settings remain accessible from the Target list. `/scopes` groups and filters assets; `/scopes/[scopeAssetId]` contains identity, structured intelligence, changes, coverage, history, paginated artifacts and secondary raw evidence. The historical `/scopes/[programId]` URL redirects to the Target filter. Unassigned old hosts remain readable/adoptable explicitly.

## Reused architecture and additive storage

The user-facing Target is `BountyProgram`; existing `Target` rows remain technical Research/worker identities. `ScopeAsset` from `20261102220000_scope_assets` remains the authorization boundary. Its original value, normalized value, deterministic format, editable functional type and user-defined value are preserved. Escaped `\\*`/`\\.` document input is normalized by the existing detector. IP/CIDR and single-label hostnames remain documentation-only because the current execution identity does not support them safely.

Migration **20261103160000_adaptive_recon_playbooks** adds:

- `TargetReconRun`, immutable parent membership through `ScanRun.targetReconRunId`, captured `reconPlan` and asset snapshot, deterministic `reconOrder`, preflight metadata and materialized Markdown/digests;
- normalized `ReconArtifact` records attached to the existing child `ScanRun` and `ScopeAsset`, with unique kind/canonical-key, scoped/observed state, JSON provenance and first/last timestamps;
- child tool versions, artifact schema version, diff and Markdown/digest;
- `PARTIAL` and `BLOCKED` coverage states; existing terminal run outcomes are reused;
- a SQL partial unique index preventing two live parent runs for the same Target.

No historical migration is changed. No historical outcome, parent, artifact, execution attempt or agent session is invented. Assigned legacy asset runs are converted once, on access, from existing v1/corpus/discovery/log adapters; original evidence is retained. Unassigned legacy program runs retain the existing Research compatibility reader because assigning a synthetic asset would invent authorization. Historical Research snapshots/deliveries remain immutable.

## One deterministic planner

`src/lib/reconPlanner.ts` is the sole asset planner. No model chooses tools or budget. **Activity and depth are independent**: effective authorization determines PASSIVE/ACTIVE; value determines LIGHT/STANDARD/DEEP. A revoked/nonexecutable or action-shaped exact URL cannot gain permission from Critical. Unsupported formats fail closed. Free-text engagement rules are preserved in briefs; they are not interpreted as executable policy.

| Format | Discovery | Active branch, when authorized |
|---|---|---|
| Wildcard domain | Subfinder + Amass passive + Assetfinder, independent bounded sources | Validated descendants → DNS → HTTP → rank → enrich selected hosts |
| Domain | No parent-domain enumeration | Exact authorized hostname only |
| Subdomain | No parent-domain enumeration | Exact authorized hostname only |
| URL | No parent-domain enumeration | Exact scheme/origin/port/path; host-wide Nmap skipped |
| IP/CIDR/single-label hostname | Metadata retained | Not supported by current execution identity |

| Type | Enrichment |
|---|---|
| Wildcard | Broad mapping first; deterministic host ranking and bounded deep enrichment |
| Web Application | HTTP/headers/TLS, links/forms/JS references, auth and route observations, WEB ffuf profile |
| API | API/docs/OpenAPI/Swagger/GraphQL references, response patterns/auth challenges/parameter names, API ffuf profile |
| Other | Conservative format branch; content tools only after a responding HTTP service |

The **format** grants enumeration shape: changing an exact host's type to Wildcard never authorizes sibling hosts. All types require actual web availability before web content enrichment. Declared methods from forms/specs are kept separate from observed GET requests; no form is submitted.

### Central budgets

All defaults are in `RECON_BUDGETS`/`RECON_CAPACITY`; changing them requires review and matrix tests. Values are upper bounds, not a promise of exhaustive coverage.

| Value | Depth | Wildcard duration | HTTP RPS | Requests | Hosts / enriched | ffuf seconds / depth / words | Fixed ports | Templates |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Low | LIGHT | 180s | 1 | 60 | 4 / 1 | 15 / 0 / 6 | 2 | 1 |
| Medium | STANDARD | 600s | 2 | 240 | 12 / 3 | 30 / 1 / 12 | 4 | 2 |
| High | DEEP | 1200s | 2 | 600 | 24 / 5 | 60 / 2 / 20 | 12 | 3 |
| Critical | DEEP | 1800s | 3 | 1200 | 40 / 8 | 90 / 3 / 30 | 23 | 4 |

Exact hosts enrich one host, cap duration at 900s and requests at 600. URLs cap duration at 600s and requests at 300. URL Nmap ports are empty. Web/API exact hosts filter the configured fixed ports to web ports. Passive-source timeouts: 20/45/90/120s. Crawl page limits: 3/8/15/25. No full 65,535-port scan. Global assets=2, per Target=1, per native tool=1 via Redis leases; therefore target HTTP RPS≤6 globally for these workers. Nmap rate is bounded separately. API and Web use separate small curated internal wordlists because the repository did not supply compatible profiles. Native unlimited recursion is disabled; the worker validates each recursion base. These lists deliberately favor read-only mapping, not exploitation.

Examples returned by the planner (no public scans are run for these examples):

| Asset / Type / Value | Activity + depth | Duration / requests | Shape |
|---|---|---|---|
| `*.vfsevisa.com` / Wildcard / Critical | ACTIVE + DEEP | 1800s / 1200 | 3 passive sources; up to 40 validated hosts, 8 enriched; 23 fixed ports; WEB_DEEP, 4 templates |
| `www.vfsvisaonline.com` / Web Application / High | ACTIVE + DEEP | 900s / 600 | Exact host; 8 web ports; WEB_DEEP (60s, depth2,20 words); 3 templates |
| `https://equatorialguinea-evisa.com` / Web Application / Medium | ACTIVE + STANDARD | 600s / 240 | Exact normalized URL; no Nmap; WEB_STANDARD (30s,depth1,12 words); 2 templates |
| `agents.tasheer.com` / API / High | ACTIVE + DEEP | 900s / 600 | Exact host; 8 web ports; API_DEEP; docs/spec routing; 3 templates |

Host ranking allocates collection budget, not vulnerability likelihood: responding HTTP +50; auth +25; API/admin +20 each; selected hostname tokens +15; unusual port/recent change +10; technology +5. Current first pass uses hostname and collected HTTP/auth/API/admin evidence; optional technology/port/change signals are supported by the pure ranking helper. Ties use hostname. Research priorities separately rank explicit asset value first and observed auth/API/admin/new surface/technology/open ports, with artifact IDs, dates, confidence and reasons. No signal confirms a vulnerability.

## Tools, versions and phases

Preflight inspects actual binary availability, version/help and required flags, and records them with each run. It never performs runtime updates. Assetfinder has no reliable version option, so its executable SHA256 is recorded. An optional missing engine produces explicit Partial coverage while retaining successful engine results.

Pinned/audited build: Subfinder2.17.0, Amass4.2.0, Assetfinder0.1.1, HTTPX1.12.0, Nmap7.93 (Debian package), FFUF2.1.0 (binary reports2.1.0-dev), Nuclei3.11.1. Go tools and existing optional scanners are pinned in Dockerfile; the Debian base/package remains distribution-managed. General Nuclei template checkout is pinned to commit `79fb682760ab3d5b0e22afbb44709353cbebf023` (v10.5.1); adaptive Recon uses only the repository's four trusted templates v2.0.0. No new scanner family is introduced. Existing Katana/dnsx/gau/dalfox are retained for historical functionality; adaptive playbooks do not invoke them.

- **Subfinder:** wildcard passive phase, structured JSON/provider provenance; `-all` for deep plans.
- **Amass:** wildcard independent passive phase, isolated temp graph directory, bounded timeout. v4.2.0 is passive by default; `-passive` is accepted/deprecated. Its actual graph `(FQDN)` output is parsed; unsupported `-src` is not generated.
- **Assetfinder:** wildcard independent `--subs-only`, external results documentary until authorized.
- **HTTPX:** after guarded availability checks; native JSON collection through the per-run relay.
- **Nmap:** only resolved authorized concrete hosts, fixed ports and connect scan, no scripts or exploitation. CNAME observations never replace the authorized hostname with the external alias for execution.
- **FFUF:** only selected responding web services; separate WEB/API light/standard/deep profiles; calibration, one thread, rate/runtime/error stops. Worker-managed, scope-checked recursion.
- **Nuclei:** only selected web services and four explicit GET-only surface templates (headers, auth challenge, API markers, panel-like content). Allowlisted IDs/methods/paths; deny DoS/fuzz/bruteforce/destructive/intrusive/code/headless/workflows/OAST. No full template-directory scan, automatic findings or raw response persistence.
- **Burp MCP:** reads existing bounded history only; no agent starts or active replay. Signed, short-lived web→console collection ticket; worker→web HMAC exact-run authorization. No Docker topology changes or worker access to the signing key. Request/response SHA references, host/path/method/status and source timestamp (or explicit collection-time-only warning) are retained. Optional unavailability remains Partial.

### Every-request guard and backoff

The existing Scope Asset matcher, exclusions, live approved Scope, program ownership/UA and cancellation checks are reused. Wildcards exclude the apex and neighbors; exact hosts exclude siblings; URL paths are segment-aware and retain origin/port. Discovered absolute URLs, excluded hosts, external redirects and CNAMEs remain documentary. No discovered content can amend authorization.

Native HTTPX/FFUF/Nuclei talk only to a per-run loopback relay. The existing guarded HTTP client owns every **remote** request: read-only method, current authorization, required User-Agent, exact URL/path, time/request/RPS limits, manual redirects, resource cancellation and bounded response bodies. The relay rejects foreign destinations and CONNECT. Native scanner output is mapped back to the selected remote origin before persistence. HTTPX probes the relay's HTTP service: native TLS fingerprints are not misrepresented as remote TLS. A separate bounded TLS connection to the authorized original HTTPS service records remote certificate facts when available.

HTTP429 stops a host immediately; repeated403/5xx/transport failures cause slowdown then stop. FFUF native error stops complement the shared guard. Blocked/Partial is not “no findings.” The initial HTTPS and HTTP availability checks are bounded; a refused HTTPS connection does not prevent a responding authorized HTTP variant from being recorded.

## Queue, partial results, cancellation

One click captures **all active assets**, ordered Critical→High→Medium→Low (then normalized value). The existing SQL outbox publishes each child to BullMQ. Concurrent clicks coalesce on the same live parent. Redis loss preserves the durable intent. SQL capacity/advisory locks fence starts across workers; waiting jobs are delayed before any attempt is claimed. Per-tool renewable Redis leases abort their process on lease loss. Finite immutable batches prevent later high-priority additions from starving existing lower-priority members; new assets require an explicit next run.

Stages: Preflight → Passive discovery → Scope validation/DNS → HTTP surface → Host prioritization → Ports/services → Web/API mapping → Content discovery → Nuclei Recon → Burp enrichment → Normalization → Scope intelligence. Coverage has Pending/Running/Completed/Skipped/Failed/Partial/Blocked and reasons. Child failure does not discard other sources. A parent is Completed only for all successful children; mixed usable/failed/partial work is Partial; wholly unusable work Failed. Cancellation is explicit. Live state is reconciled by existing maintenance. Queued cancellation prevents execution; running cancellation drains tracked processes, resolver, relay and HTTP resources. Scope archive requests cancellation of direct and discovered-host work and pauses related tmux processes while retaining conversations/files.

The old individual asset POST now returns410 directing callers to Target Recon. Durable historical `/api/scan-runs` idempotent replays remain compatible. New unassigned/program-context runs return410; compatible assigned asset requests execute this same planner/engine and global/per-Target capacity fences. They are not a second UI or Research engine.

## Artifacts and “0 discoveries”

Each scanner parser writes normalized typed artifacts incrementally. UI counts use `ReconArtifact` counts, **not** `HostDiscovery` host-only counts and not a separate counter. Thus `/login`, `/register`, `/api/auth/register`, `/api/auth/reset-password`, `/api/courses` produce five endpoint observations even with zero discovered hosts. Raw logs remain evidence; normal consumers read stored artifacts. The original authorized seed is not counted as a new scanner discovery.

Canonical keys merge equivalent same-method URLs (fragment/trailing slash/query-name ordering), hosts, port/service and technology facts, preserving all sources and first/last timestamps. Query values and sensitive path material are sanitized. HTTP and HTTPS remain distinct services: merging them would invent protocol/accessibility equivalence. A discovered URL with unknown method remains separate from a confirmed GET; declared form methods never become observed accessibility. Technology signatures do not establish versions.

Diffs compare with the previous retained successful run: new/removed/changed hosts/endpoints/ports/parameters/services/technology/auth/API artifacts. “Removed” only means absent from this bounded sample, not no longer available; coverage warnings are mandatory. Original run data and snapshots are immutable. New Recon makes Research's existing snapshot freshness check report an update; transmission remains explicit and session-specific for both providers.

## Version2 scope.md and Research

Each terminal child materializes a deterministic asset brief. Once the parent is terminal, it materializes the global Target brief. Maintenance repairs publication gaps; downloads generate from current policy and structured evidence without changing raw Recon. Briefs include stable source-derived timestamp, format version, Target/Asset/Run IDs, authorization/exclusions/required UA, captured strategy, evidence counts, meaningful endpoints, auth/API/technology/network observations, changes, priorities, coverage, limitations, artifact references and SHA256. Remote text is escaped and treated as data. Authorization/cookie/session/API/CSRF material is never exported as a credential. Remote content cannot change instructions, MCP permissions or scope.

Markdown is bounded to128KiB, prioritizes complete sections, summarizes static assets and always retains safety/reference footer. A Target includes up to1000 asset summaries and detailed briefs for the first30 prioritized assets; each detail reads up to1000 artifacts and30 history rows. The owned paginated artifact API exposes100 rows/page and kind filtering. Research includes up to2000 artifacts/run with an explicit truncation warning. Very large global briefs reference individual documents/inventory rather than dumping static chunks. Known limitation: summaries are bounded samples, not exhaustive exports; query values are intentionally unavailable.

The existing `ResearchReconSnapshot` normalizer consumes the same canonical artifacts and old-history adapter, with per-asset type/value/boundary/provenance, source dates, confidence, differences and coverage warnings. Sanitized typed observation facts (DNS addresses, TLS metadata, service labels, auth schemes and template metadata) accompany descriptions so providers can use the evidence without parsing logs. Both Codex and Claude receive the same JSON/compact summary through the existing workspace files and explicit delivery flow. No persistent provider configuration is modified. Completing Recon never starts a CLI or overwrites an in-flight session context.

## Verification and methodological sources

Tests include requested format/type/value matrix, exclusion/path/CNAME/redirect/absolute reference handling, malformed/injected data, five-endpoint count regression, provenance/dedup/freshness, parent coalescing/capacity/cancellation/archive/rerun/new scope, historical upgrade from both pre-asset and deployed asset schema, deterministic bounded Markdown/downloads, signed Burp transport, and canonical Research input. Browser tests distinguish synthetic queued/terminal fixtures from native scanner acceptance.

`npm run test:targets:recon` uses isolated PostgreSQL/Redis and an explicitly authorized Docker-local Web/API/wildcard fixture: actual worker/BullMQ, HTTPX/FFUF/Nuclei/Nmap, normalized artifacts, exact UA/path safety, both materialized briefs and a Research snapshot. Burp unavailable is recorded Partial. Public wildcard enumeration and authenticated model inference are not simulated or claimed as tested. The wildcard run starts all three actual passive binaries in an internal Docker network, then enriches one explicitly seeded local hostname; it does not claim those offline engines discovered that seed. Passive parsers/source unions are separately fixture-tested; versions/help are inspected from installed binaries. `test:research:console` exercises native CLI configuration/tmux and a local PortSwigger wire fixture; real Burp rebuild acceptance requires its documented running stack/workspace and no active users.

Primary sources consulted, adapting principles rather than importing reconFTW:

- [Subfinder usage](https://docs.projectdiscovery.io/tools/subfinder/usage), [HTTPX usage](https://docs.projectdiscovery.io/tools/httpx/usage), [Nuclei running](https://docs.projectdiscovery.io/tools/nuclei/running).
- [Amass source](https://github.com/owasp-amass/amass/tree/v4.2.0), [Assetfinder source](https://github.com/tomnomnom/assetfinder/tree/v0.1.1), [FFUF](https://github.com/ffuf/ffuf).
- [reconFTW](https://github.com/six2dez/reconftw) phase/timeout/graceful-degradation inspiration; [PortSwigger MCP Server](https://github.com/PortSwigger/mcp-server).

## Deployment

An additive Prisma migration **is required**. Build the shared web/worker image and Research image; do not recreate the persistent console during active user sessions. No volume deletion, migration reset, forced Git update, scanner auto-update or Burp topology change is needed.

```bash
docker compose build web worker research-console
# Use the newly built image for migrations before starting new application code.
docker compose run --rm --no-deps web npx prisma migrate deploy
docker compose up -d --no-deps web worker
# When no user Codex/Claude/tmux sessions are active:
docker compose up -d --no-deps research-console
```

Burp, PostgreSQL, Redis, terminal proxy, Tailscale and OOB catcher do not require recreation for this feature. Existing live scanner jobs should finish or be explicitly cancelled before replacing workers; started attempts are not automatically replayed after interruption. Back up application data according to the existing operational policy.

## Gobuster 3.8.2

Gobuster is pinned in a separate tools-image layer and included in runtime preflight/version records. Its audited native flags are checked against installed help. FFUF is retained.

- `dir`: live authorized URL/Web Application profiles, and API STANDARD/DEEP. LIGHT uses Gobuster alone where enabled; STANDARD/DEEP partition existing curated words between FFUF and Gobuster. No duplicated wordlist sweep. One thread, 1/2/3 RPS through the same guarded relay, eight-second request timeout, 15-second LIGHT or at most 30-second higher-depth runtime, at most 6/4/8 words respectively. External process cancellation enforces the runtime. No redirect following, backup expansion, force-through-wildcard or automatic recursion. Existing HTTP backoff and request budgets apply; wildcard/error prechecks fail partially rather than bypassing protections.
- `dns`: supplementary to passive engines, only ACTIVE + DEEP wildcard assets (High/Critical). Eight or fewer deterministic candidate labels, same low rate, at most 30 seconds and 60 DNS questions. An isolated local UDP resolver validates every A/AAAA/CNAME question through the existing asset/exclusion engine before forwarding; apex/neighbours/external names are rejected. Exact domains do not authorize subdomain guessing. DNS failures preserve other evidence.
- `vhost`: deliberately disabled in current playbooks. Exact domain/subdomain/hostname assets do not authorize alternate Host headers; there is no separate wildcard vhost grant in the current asset model. The argument policy rejects attempts to select this mode. Discovered names never expand active scope.

Gobuster output is parsed into the same normalized artifacts and deduplicated with FFUF while retaining both sources. Missing Gobuster produces explicit partial coverage. Manual Format changes are captured only by subsequent plans; see [summary/lifecycle details](recon-ollama-summary.md).
