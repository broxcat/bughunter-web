# Black-box authentication and evidence review

Baseline: `a4866b22db037943a8c24ddd92e726509baa6071`, clean `main`.
Scope: simplify the user interface while retaining all Hunt families, Recon,
existing encrypted credential records, finding identities and saved reports.
This supersedes user-facing setup/questionnaire descriptions in earlier audits;
the existing technique matrices remain backend references.

## User experience

| Before | After |
|---|---|
| Per-family requirements, identity-purpose selectors, owned-object URLs | Hunt readiness: scope, User-Agent, public readiness, verified session availability |
| Login URL, email, password, cookies, bearer token and technical identity forms | Username/password **or** session cookie; Test connection saves and verifies |
| Cookie presence treated as usable authentication | VALID / INVALID / EXPIRED / UNKNOWN with Last checked timestamp |
| Explicitly configured login endpoints | Discover visible password forms and same-host login links; use stored legacy hints if present |
| Questionnaire with eight boolean answers under the historical seven-question name | CANDIDATE → EVIDENCE_REVIEW → CONFIRMED / REJECTED / INCONCLUSIVE |
| Family setup details visible during Hunt | Technical selection and diagnostic details collapsed under Advanced |

`HuntRequirements` now renders only a compact readiness summary, shared by Target,
Host and Hunt start pages. Missing authentication never disables public Hunt.
Session-dependent checks without a verified session are not applicable; supported
public and passive techniques keep running. BOLA still needs independent test
identities and discovered ownership proof; session validity does not invent those
facts. Additional accounts use the same two simple authentication methods.

## Connection verification

`POST /api/targets/:id/credentials/test` accepts either an existing credential ID
or username/password or a cookie string. The input is encrypted using the existing
AES-GCM path and never echoed. New identities receive generated account labels;
no username/password/cookie is returned after saving. The UI clears secret inputs
after testing and reloads readiness immediately.

Login discovery starts at the selected host, then bounded observed login links
and common login paths. A native password form preserves hidden fields and browser
cookies. CSRF discovery covers hidden inputs, meta tags, cookie values and observed
CSRF response headers; these values remain transient. Applicable CSRF headers are
applied automatically. Target requests carrying a bearer header can supply an
automatically observed token, stored encrypted only after session proof. No user
is asked for a token, framework, endpoint, hidden input, refresh mechanism or MFA
implementation. Unsupported MFA/SSO/captcha/complex SPA flows remain UNKNOWN.

Login submission or a session-looking cookie is insufficient. Verification uses
bounded discovered/common read-only resources and requires:

- an anonymous 401/403, login redirect or password-form denial;
- a successful authenticated response with account/object semantics;
- an independent authenticated repeat with matching content/type;
- no catch-all, error page or transport failure used as proof.

Only a successful comparison produces VALID. Explicit rejected credentials produce
INVALID. A rejected existing cookie produces EXPIRED. Unsupported flows, missing
protected resources, cancellation or ambiguous responses produce UNKNOWN. A
configured credential alone is never a verified session.

Ownership discovery compares observed object owner fields to an identity obtained
from an authenticated identity resource. Only the identity hash and discovered
object URL are persisted. Two rotated sessions for the same account cannot create
independent BOLA identities. Missing ownership/identity evidence stays unavailable;
the UI does not ask the user to manufacture it.

## Session lifecycle and boundaries

Sessions have state, checked/expiry timestamps, a discovered verification URL,
optional identity hash and a check nonce. A compare-and-set claim marks a session
UNKNOWN while checking; a stale result cannot overwrite a newer check/invalidation.
The existing encrypted columns remain the secret store; no plaintext cache is
introduced. Known cookie expiry and the configured session TTL bound reuse (20
minutes by default). State is derived as EXPIRED once that deadline passes.

`loadTargetCredentials` and readiness facts only consume VALID, unexpired material.
Hunt performs a GET-only preflight on up to two saved verified sessions, inside its
existing request budget, before authenticated discovery. This preflight never
logs in. Rejected/ambiguous sessions drop out while public testing continues.
Explicit Test connection is the only new login action. The compatibility refresh
endpoint delegates to the same verification path. Recon consumes verified material
through the same loader. Authenticated XSS confirmation now initializes its confined
browser from a verified session; it retains the inert execution control.

Connection checks use the shared HTTP probe and scoped browser. Scope/owner/active
host/exclusions/User-Agent are checked before network access and rechecked for each
request. Redirects stay manual; only safe, explicitly checked same-host login
redirect destinations are navigated. Native login POSTs are authorized only for
detected password forms or observed auth-specific actions. Other mutations are
blocked. The exact action URL and detected password field must match; registration
and business-value forms are rejected before submission. Browser WebSockets and
service workers remain disabled.

Connection limits: 30 request attempts, one active HTTP request (queued browser
subresources), 100ms minimum interval, 35-second deadline, cancellation propagation,
one check per host at a time and five checks per host per minute per process.
The existing worker and program controls remain in force. The check limiter is
process-local; it is not a distributed per-program quota. Hunt retains its stricter
read-only policy and existing global/family/request/body limits. A missing/invalid
session cannot authorize an HTTP destination or state-changing technique.

## Evidence review and compatibility

The questionnaire implementation and tests have been removed. The validation API
accepts an evidence-review state and a single reproduction/impact explanation,
rather than polarity-dependent answers. Reviewers see the existing observation and
compare baseline, probe, control, reproduction, impact, authentication context and
scope. Confirmation requires an active review, an observation, an explanation and
in-scope ownership; concurrent edits return 409. Rejection and inconclusive decisions
remain available when proof is insufficient. Only confirmed findings enter new
reports. Scanner proof/confidence remains distinct from the review decision.

The additive migration preserves all IDs, ciphertext and report links:

- existing credentials become UNKNOWN, requiring a real connection check;
- historical accepted findings map to CONFIRMED;
- historical rejected findings map to REJECTED;
- other findings start CANDIDATE;
- historical validation columns remain for compatibility, never to run questions.

The legacy cookie/bearer/login columns and credential API remain compatible with
stored records; the new UI exposes only the two black-box input modes. Previous
login URLs may be reused as scoped hints. Existing saved report markdown is not
rewritten. Apply `prisma migrate deploy` during deployment before starting the new
application/worker. This phase builds a validation image; it does not migrate or
restart the running application.

## Validation

All target fixtures and browser requests are local. The E2E script requires an
explicit loopback app URL and a dedicated `bughunter_blackbox_e2e` database; it never
uses the application's database. PostgreSQL/Redis fixtures and the isolated app are
removed/stopped after validation.

Coverage includes no credentials, verified credentials, bad passwords, valid and
expired cookies, malformed cookie rejection, four CSRF sources, scope denial,
User-Agent capture, pacing, cancellation, concurrent/stale checks, session
invalidation, public Hunt, authenticated BOLA/JWT/XSS paths, minimal readiness,
absence of manual technical fields, questionnaire removal, review transitions,
report generation and migration compatibility.

| Check | Result |
|---|---|
| Full Vitest suite, disposable PostgreSQL and real local tools/Chromium | 327 passed, 0 skipped, 31 files |
| New test cases | 40 added; 14 questionnaire-specific cases retired; net +26 relative to 301 |
| Black-box browser workflow | 14 checks passed, including 390/1366px layouts |
| Existing Target browser smoke | Passed: create/edit, scope, required UA, exclusions, enqueue, historical navigation |
| Existing Hunt browser workflow adapted to the new UI | Passed: public readiness, safe credential metadata, default-off approval, queue/progress, Advanced diagnostics, evidence and mobile layout |
| Additive upgrade on an empty disposable database | Passed: IDs/ciphertext/report links retained; accepted/rejected statuses migrated; old sessions UNKNOWN |
| TypeScript, ESLint, Next.js production build | Passed |
| Docker application build, Compose including Tailscale profile | Passed; unchanged Dockerfile emits its existing placeholder-ENV warnings |
| `git diff --check` | Passed |
| Changed-path secret-pattern review | 51 paths reviewed; no private-key or known credential/token pattern matches |

The new unit/connection suites cover 38 cases; one new evidence-review API case
and one authenticated Chromium XSS case complete the 40 added cases. The generic
Hunt/authorization suites remain, with intentional expectations updated for
verified sessions and non-applicable authenticated checks. Historical deep UI
scripts are adapted away from deleted credential/gate controls; only the isolated
workflows listed above are executed during this phase.

No application deployment is performed. Only disposable local services are used
for migration and browser checks. The built validation image is
`bughunter-ux-validation:local`.

## Changed files

51 paths, including the removed questionnaire implementation/tests:

```text
README.md
docs/BLACKBOX-AUTH-UX.md
prisma/migrations/20261026230000_blackbox_sessions_evidence_review/migration.sql
prisma/schema.prisma
src/app/(dashboard)/hosts/[id]/page.tsx
src/app/(dashboard)/settings/page.tsx
src/app/(dashboard)/targets/[id]/findings/page.tsx
src/app/(dashboard)/targets/[id]/report/page.tsx
src/app/api/findings/[id]/validate/route.ts
src/app/api/findings/route.ts
src/app/api/reports/route.ts
src/app/api/targets/[id]/credentials/route.ts
src/app/api/targets/[id]/credentials/test/route.ts
src/app/api/targets/[id]/hunt-readiness/route.ts
src/components/EvidenceReview.tsx
src/components/FindingClassification.tsx
src/components/HuntRequirements.tsx
src/components/HuntRunProgress.tsx
src/components/ScanStart.tsx
src/components/TargetAuthentication.tsx
src/lib/evidenceReview.ts
src/lib/gate.ts
src/lib/hunt/readiness.ts
src/lib/targetAuth.ts
src/server/brain/triage.ts
src/server/credentials/autoLogin.ts
src/server/credentials/connection.ts
src/server/credentials/csrf.ts
src/server/credentials/guard.ts
src/server/credentials/index.ts
src/server/execution.ts
src/server/hunt/corpus.ts
src/server/hunt/readiness.ts
src/server/hunt/runtime.ts
src/server/hunt/techniques.ts
src/server/scanners/context.ts
src/server/scanners/http.ts
src/server/scanners/xssConfirm.ts
tests/e2e/blackboxUx.mjs
tests/e2e/deepDetails.mjs
tests/e2e/deepInteractions.mjs
tests/e2e/fixtures/deepTarget.mjs
tests/e2e/huntWorkflow.mjs
tests/integration/apiRoutes.test.ts
tests/integration/blackboxConnection.test.ts
tests/integration/huntRuntime.test.ts
tests/migrations/programUpgrade.mjs
tests/network/scannerHttp.test.ts
tests/unit/blackboxAuth.test.ts
tests/unit/gate.test.ts
tests/unit/huntReadiness.test.ts
```
