# Deep end-to-end functional audit

## Environment / baseline

Starting main: `f77f4db154c3daddaa32ab1e6e5a36b7ba68e0be` (2026-10-26).
Branch `test/deep-e2e-app-audit` created and pushed before modifications.
Existing compiled application: local Docker web on port 3000, Postgres/Redis
healthy, worker and OOB catcher running. Existing volumes/data are preserved.
Disposable audit Postgres/Redis use ports 55445/55446. No reset/down-volume command.
Chromium/Playwright exercises the actual compiled application. Viewports:
1920×1080, 1366×768 and 390×844. No traces, videos, storage-state files, password
screenshots or raw request/response dumps. E2E credentials are consumed in memory
only for app login. Target credentials are independent disposable fixture values.

## Page / API inventory

This inventory was produced before application changes. `p` means a business
program ID; `h` means a technical host ID; `r` means a scan run ID.

| Page | Route | Purpose | Authenticated? | API dependencies | Expected redirect | Tested | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Root | `/` | Entry | No | Auth proxy | `/targets`, then login if anonymous | Pending | Pending |
| Login | `/login` | Sign in | No | Auth CSRF/session/credentials callback | callbackUrl or `/targets` | Pending | Pending |
| Register | `/register` | Account creation | No | POST `/api/register`, Auth callback | `/targets` | Form only | No new account required |
| Targets | `/targets` | Program list/create | Yes | `/api/programs` | Anonymous login | Pending | Pending |
| Target | `/targets/p` | Program information/edit/readiness | Yes | `/api/programs/p`, `/api/targets/p` legacy fallback, `/api/targets/h/hunt-readiness` | Legacy host → `/hosts/h` | Pending | Pending |
| Scopes | `/scopes` | Program grouping/legacy adoption | Yes | `/api/programs`, `/api/targets`, `/api/programs/p/hosts` | Anonymous login | Pending | Pending |
| Scope | `/scopes/p` | Host and exclusion CRUD | Yes | `/api/programs/p`, `/api/programs/p/hosts[/h]` | Anonymous login | Pending | Pending |
| Host | `/hosts/h` | Historical scans/credentials/actions | Yes | `/api/targets/h`, credentials/test/refresh, `/api/scan-runs`, log stream | Anonymous login | Pending | Pending |
| Recon | `/recon` | Target/host selection | Yes | `/api/scan-hosts`, POST `/api/scan-runs` | Start → `/hosts/h` | Pending | Pending |
| Hunt | `/hunt` | Selection/readiness/approval | Yes | scan-hosts, hunt-readiness, scan-runs | Start → `/hunt/r` | Pending | Pending |
| Hunt run | `/hunt/r` | Techniques/evidence/progress | Yes | `/api/scan-runs/r/hunt` polling | Anonymous login | Pending | Pending |
| Findings | `/targets/h/findings` | Findings and manual triage | Yes | `/api/findings`, PATCH finding, validate | Back → host | Pending | Pending |
| Report | `/targets/h/report` | Generate markdown from passed findings | Yes | `/api/findings`, POST `/api/reports` | Back → host | Pending | Pending |
| Settings | `/settings` | AI providers/operator OOB guidance | Yes | `/api/ai-providers` | Anonymous login | Pending | Pending |
| Health | `/api/health` | DB/Redis liveness | No | PostgreSQL + Redis | None | Pending | Pending |
| Global/legacy | `/dashboard`, `/findings`, `/reports` | No page implemented | Proxy protects first | None | Anonymous login; authenticated 404 | Pending | Inventory limitation |

Main menu contains Targets, Scopes, Recon, Hunt and Settings. Findings/report links
are host-specific. No cancellation endpoint or Quick/Deep/continuous Recon mode
exists in the current route inventory. Approval is a per-run checkbox, not an
asynchronous approval modal with rejection/expiry endpoints.

## Coverage

Results are populated as the real browser scenarios finish. Unit/integration tests
are supplementary and will not be represented as browser coverage.

### Baseline browser run

Chromium 156.0.8078.4: 28 PASS checks on the compiled application. Direct private
URLs preserve callbackUrl; login with supplied credentials succeeds. Session cookie
is HttpOnly, SameSite=Lax, Secure=false on local HTTP. Main-menu navigation and
refresh pass at three viewport widths. Logout invalidates navigation after refresh
in a second tab. `/dashboard`, `/findings`, `/reports` produce authenticated 404s
because global pages are absent; their resource/console 404 events are expected
inventory limitations, not hidden as successful page tests. Use the canonical
AUTH_URL origin (`localhost:3000`) for logout; an alternate loopback origin returns
to that configured canonical host. No secret/cookie value was captured.

## Bugs discovered — health dependency outage

- Severity: MEDIUM (operational liveness/readiness).
- Route: `/api/health`.
- Reproduction: start the separately compiled audit app against disposable services,
  stop only `bughunter-deep-audit-redis`, request health from Chromium's HTTP client.
- Expected: bounded 503 with Redis down; observed: request still pending after 3500ms.
- Root cause: health used BullMQ's shared Redis client with unlimited retries.
- Fix: dedicated nonretrying Redis connection, 1500ms concurrent dependency deadlines,
  unconditional connection disposal and generic dependency status only.
- Regression: three route tests, plus actual built-app Redis outage/recovery smoke.
  After fix the outage returned 503 in 11ms. Existing services were not stopped.
- Commit: `fix(health): bound dependency checks during service outages`.

## Bugs discovered — unsafe post-login destination

- Severity: MEDIUM; route `/login?callbackUrl=...`.
- Steps: provide an external callbackUrl, sign in with the E2E account. Browser
  routing to the foreign destination was intercepted and aborted before traffic.
- Expected: remain inside BugHunter; observed: UI attempted external navigation.
- Root cause: raw query value passed directly to the client router after sign-in.
- Fix: accept only relative internal paths; reject schemes, double slashes,
  backslashes and control/whitespace characters; default to `/targets`.
- Regression: unit URL matrix and compiled Chromium relative/external callback tests.
- Commit: `fix(auth): restrict post-login navigation to internal paths`.

## Bugs discovered — login network failure

- Severity: MEDIUM; route `/login`.
- Steps: Chromium aborts the credentials callback request (URL pathname matcher,
  including Auth.js query variants), then submits the supplied credentials.
- Expected: safe retry error and enabled Sign in button. Original compiled app:
  unhandled promise rejection and loading state not restored.
- Root cause: awaited `signIn` had no catch/finally.
- Fix: generic network message plus loading reset in finally; invalid credentials
  retain their separate safe message. No request body or exception detail logged.
- Regression: same intercepted browser failure against old image and fresh build;
  fresh build stays on login, shows retry error and restores the button.
- Commit: `fix(auth): recover login form after network failure`.

## Bugs discovered — stale authenticated second tab

- Severity: MEDIUM; all authenticated dashboard pages.
- Steps: sign in, open a second Targets tab, sign out in the first and focus the
  second. Before fix its authenticated content remained until manual refresh.
- Expected: clear stale authenticated UI and return to login without manual refresh.
- Root cause: dashboard had no Auth.js session subscriber for signout broadcasts.
- Fix: standard SessionProvider around authenticated content; unauthenticated
  status immediately hides content and navigates to login. Session is rechecked
  on focus; no token/cookie storage was introduced.
- Regression: actual two-tab Chromium signout, no manual reload; passed on build.
- Commit: `fix(auth): clear stale dashboard sessions across tabs`.

## Bugs discovered — saved report inaccessible after refresh

- Severity: MEDIUM; `/targets/h/report`.
- Steps: use an actual confirmed BOLA result from the local fixture Hunt, pass the
  manual gate, generate its report and reload the page.
- Expected: saved report remains accessible. Observed: report exists in GET reports,
  but UI discards markdown on refresh and has no history selector.
- Root cause: preview existed only in React state; page never loaded stored reports.
- Fix: owned host-filtered report history and saved-report selector; latest saved
  preview restored after refresh, without regenerating or changing historical data.
- Regression: four API ownership/filter tests and real compiled browser generation,
  persistence, reload and all three viewport widths. All pass.
- Commit: `fix(reports): restore saved host report previews after refresh`.

## Bugs discovered — public XSS readiness warning

- Severity: LOW (misleading preflight); Target/Hunt readiness.
- Reproduction: Recon observes successful anonymous query endpoints on the public
  fixture, with no credentials. XSS still required a recommended session globally.
- Expected: public XSS can be READY when browser confirmation is available.
- Root cause: session recommendation was unconditional, independent of corpus.
- Fix: persist a nonsecret public-XSS coverage fact only after anonymous successful
  parameter-page observations; omit the session recommendation for that observed
  public coverage. Authenticated, unknown or mixed/denied observations retain the
  recommendation. Old metadata defaults to unknown conservatively. No migration.
- Regression: readiness and corpus tests (anonymous/public, authenticated, denied,
  no observations), plus a new actual Recon on the isolated worker and Target UI.
  Browser: XSS READY, BOLA/JWT BLOCKED, OAuth/XXE NOT_APPLICABLE before Hunt.
- Commit: `fix(hunt): recognize observed anonymous XSS readiness`.
