# PayloadsAllTheThings: Hunt coverage and validation

## Audit and source

Audit baseline: BugHunter `116530ab29daa8dd5878a87830bf58a4320e3bb3`, clean
`main`, `git fetch origin` successful, 2026-10-26. Before changes: 161 passing
tests, 30 skipped (including opt-in tool/browser captures).

Methodological source: [PayloadsAllTheThings at
3ac27901c711bdf3f5b65a7b1d1820a1f65bd09a](https://github.com/swisskyrepo/PayloadsAllTheThings/tree/3ac27901c711bdf3f5b65a7b1d1820a1f65bd09a).
Cloned into `/tmp/bughunter-patt-reference`, never vendored or loaded at runtime.
Its LICENSE is MIT, copyright (c) 2019 Swissky. Techniques are reimplemented;
short conventional expressions and encodings are attributed in the probe registry.
The license notice is retained in `docs/licenses/PayloadsAllTheThings-MIT.txt`.

Read all scanner modules (18 family dispatchers, auth-bypass classifier,
discovery, recon, runCommand, http, context, timingProbe, toolPolicy, xssConfirm),
the actual implementations in `server/hunt`, and the policy/readiness/catalogue,
approval and report models in `lib/hunt`. Legacy audit documents describe older
implementations: the current Hunt uses the bounded catalogue, no external CLI.
The Next.js installed route-handler guide was read before editing.

## Coverage matrix (audit first; implementation results below)

| Family | BugHunter before | PayloadsAllTheThings methodology | Gap | Action |
|---|---|---|---|---|
| SQLi | Single quote errors; numeric AND differential; approved fixed timing | DBMS errors; numeric/string contexts; encoding, comments; UNION, blind | First input only; generic error match; status-only negative can mislead | Bounded input selection, DBMS signature agreement, string/comment variants, stable negative content controls; no extraction/stacked writes |
| XSS | Reflection; DOM keyword; confined browser dialog | HTML/attribute/JS/URL, DOM, encodings, stored | Browser may mistake an application dialog echo for injected execution | Central context variants, inert canary browser control, reflection remains candidate; stored deferred |
| SSRF | URL inventory; two operator OOB tokens | IPv4/IPv6/alternate IP, parsers, redirects, schemes, DNS | Unsafe destinations must never be defaults | Preserve HTTP(S) operator-only callbacks; strengthen callback validation; all alternate internal IP/metadata probes deferred |
| IDOR/BOLA | Numeric/UUID/query inventory; attested A/B JSON replay | Nested/encoded/hashed IDs, body/query/path, multi-account | Nested/opaque discovery; object validation | Extend passive reference coverage; preserve owner-attested exact-object replay, no neighbor guessing |
| CORS | Four origins; credentialed HTTP comparison | Reflection, null, wildcard, trusted origin patterns, scheme/port | Pattern coverage; duplicate candidates; credentialed wildcard | Bounded deduplicated origin matrix; label configurations and invalid wildcard separately; browser feasibility still unconfirmed |
| CSRF | Forms, cookie metadata, JS API inventory | GET/POST, JSON/multipart, tokens, SameSite, Origin/Referer, transformations | GET action and token-context inventory | Extend passive method/content-type/token review; never submit action or infer token validation |
| XXE | XML response and parser inventory | Entities, XInclude, SOAP, blind/OOB, SSRF | Distinguish XML support from entity expansion | Add passive XInclude/entity/parser classification; active XML POST deferred without read-only fixture contract |
| LFI/traversal | Missing benign filename error | URL/double/Unicode, mangled paths, normalization, null/suffix | Encodings absent; no safe file contract | Harmless nonexistent-path variants with repeat/control; no system file retrieval; errors remain candidates |
| Deserialization | Prefix regex on cookies/query/hidden values | Java/PHP/Python/Ruby/.NET binary signatures | Prefix-only false positives; missing formats | Bounded passive decode and structural magic checks; no deserializer or gadgets |
| Command injection | Passive hints; approved 1/2s sleep pairs | Separators, quotes, arguments, whitespace, timing/OOB | Payload strings embedded in timing helper | Central typed fixed probes; retain explicit approval and content/jitter controls; argument/OOB execution deferred |
| SSTI | Two syntaxes, 49/64 plus inert control | Rendered, errors, boolean, timing/OOB, polyglots, engines | No baseline, fixed expected values, no technology selection | Central arithmetic variants, technology hints, repeated deterministic evaluation and inert/baseline controls; no OS commands |
| JWT | Metadata and two corrupted signatures | none, signature, algorithm/key selection, kid, claims | Other ambient credentials may authenticate; limited metadata | Isolate tested token; none/null-signature, benign kid rejection and claims metadata; no secret guessing or remote keys |
| OAuth | State/PKCE/response-type inventory | redirect_uri, codes, referer/token leakage, client confusion | Control inventory incomplete | Passive redirect/PKCE/leakage flags only; never follow authorization or obtain real tokens |
| Business logic | Passive action/value/workflow/replay hints | Quantity/price/discount, rounding, duplicate/TOCTOU, sequence | Missing field variations, workflow context | Broaden passive field/action taxonomy; replay/races/mutations remain unsupported pending reversible fixture contract |
| Authentication | Auth/anonymous JSON, routing header, catch-all | Authorization/routing controls (related IDOR methodology) | Catch-all sent without routing header | Apply same routing technique to an independent absent path; retain status/content/object controls |
| Information disclosure | Git HEAD minimal repeated marker | Not expanded in this phase | No relevant safe gap | Retain existing minimal proof |

## New family assessment

Statuses describe the current engine's usable subset, not full vulnerability support.
No new family is enabled solely because its name exists in the reference.

| Family | Status | Reason |
|---|---|---|
| GraphQL injection/introspection | PARTIAL | HTTP GET and passive discovery fit; safe schema queries need explicit query-only contract, selection/policy and cost limits. No mutation/batching/deep query added. |
| Mass Assignment | DEFERRED | Confirmation changes object fields; no rollback or disposable-object contract. |
| Open Redirect | PARTIAL | Manual redirect observation fits; dedicated policy/readiness and redirect-specific semantic controls still needed. No redirect following. |
| HTTP Parameter Pollution | PARTIAL | Duplicate query keys fit transport, but merge differences alone do not prove security impact. |
| NoSQL Injection | PARTIAL | Passive fingerprints possible; operator/context-specific read-only confirmation and bounded fixture support needed. No authentication bypass or extraction loops. |
| Prototype Pollution | DEFERRED | Server prototype changes may persist across requests; no process-reset contract. |
| Request Smuggling | DEFERRED | Fetch cannot control wire framing/connections; shared infrastructure desynchronization unsafe. |
| Web Cache Deception | DEFERRED | Requires cache state manipulation and independent cache/identity proof; may persist sensitive content. |
| WebSocket security | DEFERRED | No authorized WebSocket transport/budget; browser sockets explicitly blocked. |
| CRLF Injection | PARTIAL | Encoded query transport exists; raw header/framing unavailable; response-splitting controls and dedicated policy remain to build. |

## Constraints preserved

All target requests use `probe` or the routed Chromium context. Exact selected
host/port, HTTP(S), no URL credentials, manual redirects, program UA overwritten
case-insensitively, scope revalidation, shared request/concurrency/deadline/body
limits apply. Recon metadata only selects techniques; it never authorizes hosts.
External CLIs cannot run inside a bounded Hunt because their request budgets
cannot be enforced. ffuf/gau/dnsx have no runtime invocation; unknown tools fail
closed. Nuclei/httpx/Katana/Dalfox retain centrally enforced UA flags and local
capture tests; ffuf remains blocked. There is no arbitrary required-header or
per-program rate-limit field in the existing model; this limitation must not be
represented as a supported program setting.

No Internet scan is part of validation: tests use local synthetic targets only.

## Techniques extracted and implementation boundaries

Each row records input vectors, detection, syntax/encoding/filter variations,
technology differences, confirmation, false positives, prerequisites and risk.
The family source links are pinned in `lib/hunt/references.ts`; the probe-level
section is recorded in `lib/hunt/payloads.ts`.

| Family | Inputs, detection and variants studied | Confirmation, prerequisites, false positives and automation |
|---|---|---|
| SQLi | Query/body/path; DBMS-specific errors; numeric and quoted-string predicates; URL/double encoding, comment whitespace and keyword case; DB-specific bounded delay and UNION literals | Implements query only, two inputs maximum. Same DBMS errors must repeat without baseline/inert errors; positive content matches original and repeated negative content differs with identical status/type. String/comment variants constrain the original filter. Static SQL text, WAF errors and generic status flips are insufficient. SAFE; fixed timing REQUIRES_APPROVAL. UNION/column enumeration, alternate quote/double-encoding sweeps, second-order writes and extraction are deferred. |
| XSS | HTML text, attributes, JS, URL wrappers; DOM hash/query and source/sink; HTML/URL encodings, quote breakouts, filter behavior, stored input | Context hint selects HTML/attribute/JS variant; browser must observe exact fresh canary after an inert canary control. Literal/encoded reflection and sink keywords are leads only; application dialog echoes are FALSE_POSITIVE. SAFE. Browser remains anonymous; authenticated-only XSS can stay inconclusive. URL interactions, stored/blind writes and postMessage workflows need confined action contracts and are deferred. |
| SSRF | URL inputs; IPv4/IPv6, integer/hex/encoded IPs, userinfo/parser discrepancies, redirects, DNS rebinding and non-HTTP schemes | Only configured operator HTTP(S) controller is used; two unique database-correlated callbacks establish fetch behavior (VALIDATED), not arbitrary internal access. No worker-side callback request. Missing callbacks remain candidates; callback polling stops on cancellation. LOW_IMPACT. Numeric/link-local/mapped/known metadata destinations are rejected as controller defaults. Alternate-address, redirect/rebinding, gopher/file/dict and metadata techniques are not sent. Operator must own the configured controller and keep it free of redirects/rebinding. |
| IDOR/BOLA | Numeric/UUID, nested query keys, encoded/hashed references, static filenames, body field references and account replay | Discovery does not decode ownership or guess neighbors. Active replay requires two explicit test identities and an owner-attested object URL. Top-level valid JSON object/content hashes must repeat under A/B and differ from successful anonymous/401/403 controls; timeout/redirect is not denial. LOW_IMPACT replay; SAFE inventory. Mutable body/path guessing and wildcard bulk retrieval deferred. |
| CORS | Origin reflection, null, wildcard, trusted-origin prefix/suffix/dot patterns, scheme/port/subdomain variations | Eight headers maximum, never connections to those origins. Wildcard plus credentials is a browser-rejected exploit claim, deduplicated as FALSE_POSITIVE; arbitrary reflection remains configuration CANDIDATE. Credentialed matching JSON plus independent anonymous content remains VALIDATED until browser cookie feasibility/readability is demonstrated. SAFE. A deliberately trusted subdomain or public API is not automatically vulnerable. |
| CSRF | GET actions, URL-encoded POST, multipart, JSON/simple/complex request rules, token names, SameSite, Origin/Referer and method/content-type transformations | Passive form/API/cookie inventory includes action-shaped GET forms and content types. Missing tokens or SameSite=None are signals; token presence does not prove validation. Browser-origin, token omission/transformation and side-effect comparisons require an explicitly disposable reversible action. SAFE inventory; submissions REQUIRES_APPROVAL and currently UNSUPPORTED. |
| XXE | XML/SOAP, internal/external and parameter entities, XInclude, UTF encodings, blind OOB and XXE-to-SSRF | Passive XML support and entity/XInclude/parser flags only. Declaration does not prove expansion; a normal XML response is not XXE. A future read-only fixture would need external-entity callback correlation and inert XML controls. SAFE inventory. XML POST currently unsupported; no sensitive file reads, expansion bombs or remote DTD exfiltration. |
| LFI/traversal | File/path query inputs; URL/double/mixed encoding, Unicode, mangled paths, semicolon/proxy normalization, null byte, prefix/suffix/truncation | Up to three applicable variants use fresh nonexistent `.txt` names; plain filename and ordinary baseline precede repeated parser-error checks. IIS/ASP.NET and Tomcat hints gate their variants. Errors remain CANDIDATE, never file-read/traversal proof. SAFE. A real non-sensitive fixture contract is still needed for confirmation; legacy null-byte/version-specific, overlong UTF and suffix truncation are deferred, system files forbidden. |
| Deserialization | Query, hidden field, cookie; Java stream magic, .NET ViewState/BinaryFormatter, PHP text/base64, Python pickle and Ruby Marshal | Bounded URL/base64 decode and structural signatures only; never invoke a deserializer. Framework signatures indicate format, not exploitation. Prefix fragments, arbitrary base64 and JWTs are negative controls. SAFE. YAML and deeper framework behavior/gadget chains are not automatically exercised. |
| Command injection | Command-shaped queries; separators, quote contexts, argument injection, whitespace/IFS, Windows/Unix, short timing and OOB | Fixed existing `sleep`/zero-delay pairs moved into the registry; only explicit per-run timing approval enables them. Three interleaved pairs at 1s and 2s must track with unchanged content and low jitter. Errors alone remain SIGNAL. REQUIRES_APPROVAL. No new shell/argument/whitespace/OOB execution probes are enabled because tool/OS and side effects cannot be inferred safely. |
| SSTI | Template/query inputs; rendered arithmetic, error/boolean pairs, polyglot syntax, time/OOB; curly/dollar/hash/EJS families | Recon technology chooses two syntax families; ordinary/inert controls, two arithmetic results and independent repeat required. Literal reflection, constant 49 responses and transport/status changes fail confirmation. SAFE. Syntax does not uniquely identify an engine. No engine escapes, file reads, OS commands, error polyglot sweeps or time/OOB escalation. |
| JWT | Test bearer/cookie; signature corruption, unsigned none variants, alg/key confusion, kid/jku/jwk, exp/nbf/iss/aud | Isolate token from every other cookie/bearer; valid JSON object and anonymous control before two invalid variants plus repeat. Original identity claims unchanged. Missing benign kid remains CANDIDATE even if accepted. Claim/header presence is passive metadata, never proof of enforcement. SAFE. HMAC/RSA confusion needs explicit trusted public-key fixture; key URL/path injection and secret brute force forbidden. |
| OAuth | Observed authorization URLs; state/PKCE, redirect_uri, implicit tokens, code reuse/exchange, referer/redirect chains and client confusion | Review redirect shape, state/PKCE/response-type/client metadata and passive referrer/token-fragment flags without storing their values. Presence/absence does not prove CSRF, token leakage or validation. SAFE. No authorization endpoint navigation, consent, grants, code redemption, account linking or real-user token collection. |
| Business logic | Quantity/qty, amount/price, discount/coupon, currency/balance, role/plan; workflows, retry/idempotency, limit overrun/TOCTOU and synchronization | Broader passive field/action taxonomy only. Client fields, duplicate-success text or status codes are insufficient. Confirmation would require initial/final owned-object state and rollback/isolated money/capacity fixtures. SAFE inventory. Race/replay/mutation/sequence bypass REQUIRES_APPROVAL and remain UNSUPPORTED, including last-byte/HTTP2 synchronization. |

## Risk enforcement and validation levels

`probeRisk` supplements the existing PASSIVE/SAFE_ACTIVE/STATE_CHANGING/HIGH_RISK
UI classification without changing historical reports:

- SAFE: passive formats, reflection, arithmetic, CORS headers and malformed syntax.
- LOW_IMPACT: configured OOB callbacks and owner-attested test-account read replay.
- REQUIRES_APPROVAL: fixed bounded timing; stored/state/business actions are still
  unsupported even with an approval string. Only the four existing timing IDs
  are on the approval allowlist.
- FORBIDDEN_AUTOMATIC: internal SSRF sweeps, sensitive file reads, signing-secret
  recovery and deserialization gadgets. Both planning and dispatch reject this
  tier even if a descriptor is marked implemented and its ID is approved.

DoS/resource exhaustion, destructive writes, persistence, secrets/credential
exfiltration and unnecessary RCE are never implemented. Approval cannot enable
them. The manual Finding gate remains UNVALIDATED even after scanner confirmation.

Reports retain SIGNAL, CANDIDATE, VALIDATED and CONFIRMED and add FALSE_POSITIVE
and INCONCLUSIVE. Only CONFIRMED creates a Finding. VALIDATED means a controlled
behavior was reproduced without sufficient impact proof, especially CORS/OOB.
Network failures do not count as anonymous denial. Incomplete HTTP techniques
produce INCONCLUSIVE observations. Raw responses, JWTs, object contents and
query values are excluded from persisted evidence; hashes/structural metadata
are sufficient. Sensitive content stays in transient memory only.

## Adaptive execution and counts

32 centralized variants comprise SQL 4, SSTI 4, XSS 3, paths 6, timing 2, JWT 5,
CORS 8. Of these, 14 consolidate previous techniques and 18 add methodological
variants (SQL 2, SSTI 2, XSS 1, paths 6, JWT 3, CORS 4). Independent canary values,
control/repeat requests and passive signatures are not counted as payloads.
Two new catalogue techniques cover JWT unsigned algorithms and benign key IDs;
no new scanner family is enabled.

Selection reuses Recon hints and the existing static/cache-buster parameter
filter. SQL tries at most two inputs; SSTI at most two applicable syntaxes; path
handling at most three. No Cartesian product of encodings is generated. Normal
URLSearchParams serialization applies exactly one transport layer; percent
sequences in double/mixed probes are deliberately preserved through that layer.

Runtime limits: 8 unique values per route/parameter/family (including ordinary
values), 8 requests per technique, 24 per family, 100 total, 12 discovery, 4
techniques per family, 1 confirmed result per family. Remaining techniques stop
with FAMILY_ALREADY_CONFIRMED. Minimum 100ms between HTTP starts (at most 10/s),
concurrency 1, 5s HTTP timeout, 20s family, 120s global, 64KiB body cap. The shared
guard reserves/counts an attempt before waiting and releases it on abort.
Cancellation also interrupts OOB polling. These bounds intentionally trade some
coverage for predictable impact; a limit or absent proof never means safe.

Per-program custom rate limits/required headers are not stored by the current
program schema. The enforced program-specific HTTP header remains User-Agent;
credential headers still use the shared path. Operators must not interpret the
fixed 10/s upper bound as compliance with a stricter program limit. Adding those
editable settings requires a separate schema/UI phase. This change does not claim
protocol-level smuggling/WebSocket capability or full injection/body coverage.

## Validation record

All fixtures are synthetic and local. Source retrieval and dependency/image builds
use the Internet; scanner validation never targets an Internet host. Tests cover
positive/negative/static-error/WAF/catch-all/literal/dialog-echo/ambient-session
cases, encoding transport, policy denials, scope, UA, pacing, timeout, cancellation,
parameter budgets and forbidden descriptor dispatch. Passive families assert no
requests and cannot produce a confirmed finding.

The two new test files exercise registry/policy/fingerprints and local HTTP
techniques. Existing tests additionally cover the browser inert control, tool
header override spellings, ffuf rejection, and stop-after-confirmation behavior.
The full suite is run with real CLI/Chromium captures and a disposable PostgreSQL,
separate from the application's database. Detailed final counts and build results
are recorded after validation below.

| Check | Result |
|---|---|
| Full Vitest regression, PostgreSQL + real CLI/Chromium | 301 passed, 0 skipped, 30 files; 110 added cases relative to the initial 191-case suite |
| Default suite without optional infrastructure | 270 runnable cases; PostgreSQL/tool captures are opt-in (31 cases) |
| Migration upgrade against a separate empty disposable database | Passed; identity/history preservation assertions unchanged |
| TypeScript (`npx tsc --noEmit`) | Passed |
| ESLint (`npm run lint`) | Passed |
| Next.js production build (`npm run build`) | Passed |
| Compose including Tailscale profile (`config --quiet`) | Passed |
| Full Docker build | Passed, `bughunter-patt-validation:local`; existing placeholder ENV lint warnings only (Dockerfile unchanged) |
| Changed-file secret-pattern review | 25 files; no private-key or known credential/token pattern matches |
| `git diff --check` | Passed |

The disposable PostgreSQL is removed after validation. Existing application
containers/databases are neither migrated nor restarted. The validation Docker
image is tagged `bughunter-patt-validation:local`; it is not deployed.

## Changed files

- Documentation: `docs/PAYLOADS-TECHNIQUES.md`,
  `docs/licenses/PayloadsAllTheThings-MIT.txt`.
- Catalogue/policy/report: `src/lib/hunt/catalog.ts`, `catalogData.ts`,
  `payloads.ts`, `presentation.ts`, `readiness.ts`, `references.ts`, `report.ts`.
- Hunt engine: `src/server/hunt/budget.ts`, `corpus.ts`, `evidence.ts`,
  `fingerprints.ts`, `oobPolicy.ts`, `runtime.ts`, `techniques.ts`,
  `timingTechniques.ts`.
- Scanner helpers: `src/server/scanners/toolPolicy.ts`, `xssConfirm.ts`.
- Tests: `tests/integration/huntRuntime.test.ts`,
  `tests/integration/payloadTechniques.test.ts`,
  `tests/network/scannerHttp.test.ts`, `tests/unit/execution.test.ts`,
  `tests/unit/payloadsTechniques.test.ts`, `tests/unit/xssConfirm.test.ts`.

25 files; no schema migration, package dependency, downloaded payload corpus or
unrelated application/network change is included. Git publication uses the
existing `main` / `origin/main` branch and the requested feature commit message.
