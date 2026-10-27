> Historical documentation: the vulnerability-family Hunt engine is retired.
> See [Codex Research](CODEX-RESEARCH.md) for the current workflow.

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
| Root | `/` | Entry | No | Auth proxy | `/targets`, then login if anonymous | Browser | PASS |
| Login | `/login` | Sign in | No | Auth CSRF/session/credentials callback | callbackUrl or `/targets` | Browser | PASS |
| Register | `/register` | Account creation | No | POST `/api/register`, Auth callback | `/targets` | Isolated browser | PASS |
| Targets | `/targets` | Program list/create | Yes | `/api/programs` | Anonymous login | Browser | PASS |
| Target | `/targets/p` | Program information/edit/readiness | Yes | `/api/programs/p`, `/api/targets/p` legacy fallback, `/api/targets/h/hunt-readiness` | Legacy host → `/hosts/h` | Browser | PASS |
| Scopes | `/scopes` | Program grouping/legacy adoption | Yes | `/api/programs`, `/api/targets`, `/api/programs/p/hosts` | Anonymous login | Browser | PASS |
| Scope | `/scopes/p` | Host and exclusion CRUD | Yes | `/api/programs/p`, `/api/programs/p/hosts[/h]` | Anonymous login | Browser | PASS |
| Host | `/hosts/h` | Historical scans/credentials/actions | Yes | `/api/targets/h`, credentials/test/refresh, `/api/scan-runs`, log stream | Anonymous login | Browser | PASS |
| Recon | `/recon` | Target/host selection | Yes | `/api/scan-hosts`, POST `/api/scan-runs` | Start → `/hosts/h` | Browser | PASS |
| Hunt | `/hunt` | Selection/readiness/approval | Yes | scan-hosts, hunt-readiness, scan-runs | Start → `/hunt/r` | Browser | PASS |
| Hunt run | `/hunt/r` | Techniques/evidence/progress | Yes | `/api/scan-runs/r/hunt` polling | Anonymous login | Browser | PASS |
| Findings | `/targets/h/findings` | Findings and manual triage | Yes | `/api/findings`, PATCH finding, validate | Back → host | Browser | PASS |
| Report | `/targets/h/report` | Generate markdown from passed findings | Yes | `/api/findings`, POST `/api/reports` | Back → host | Browser | PASS |
| Settings | `/settings` | AI providers/operator OOB guidance | Yes | `/api/ai-providers` | Anonymous login | Browser | PASS |
| Health | `/api/health` | DB/Redis liveness | No | PostgreSQL + Redis | None | Browser | PASS |
| Global/legacy | `/dashboard`, `/findings`, `/reports` | No page implemented | Proxy protects first | None | Anonymous login; authenticated 404 | Direct browser | NOT_TESTED (page absent) |

Main menu contains Targets, Scopes, Recon, Hunt and Settings. Findings/report links
are host-specific. No cancellation endpoint or Quick/Deep/continuous Recon mode
exists in the current route inventory. Approval is a per-run checkbox, not an
asynchronous approval modal with rejection/expiry endpoints.

## Coverage

Browser execution and supplementary tests are distinguished below. No unit result
is presented as browser coverage.

### Baseline browser run

Chromium 156.0.8078.4: 29 PASS checks on the compiled application. Direct private
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

### Second-tab hydration race follow-up

The full authentication sequence reproduced a timing case missed by the initial
standalone tab test: a server-provided session could remain stale if signout
occurred before the other tab subscribed during hydration. The provider now checks
the current cookie on mount before showing authenticated content, then subscribes
to Auth.js broadcasts/focus changes. Full real-browser authentication sequence
passes all six cases (including network rejection and multi-tab logout).
Commit: `fix(auth): verify dashboard session before displaying cached content`.

## Bugs discovered — missing accessible form names

- Severity: LOW; Findings creation and report generation forms.
- Browser DOM audit found six visible controls without associated labels/ARIA names
  in Findings and two in Report. Placeholders alone did not label these controls.
- Fix: explicit accessible names on the eight existing controls; no layout refactor.
- Regression: actual Chromium label audit across Findings, Report, Settings, Recon
  and Hunt; all now have zero missing names. Login Tab order and password masking pass.
- Commit: `fix(a11y): label finding and report form controls`.

## Bugs discovered — terminal Hunt error kept polling

- Severity: LOW; `/hunt/not-owned`.
- Browser reproduction: visit a missing run while authenticated and wait beyond
  one polling interval. Observed repeated 404 requests and a contradictory Loading
  message alongside Hunt not found.
- Fix: stop polling on terminal 401/403/404; clear the loading message on failure;
  key the run component by ID so an old report cannot appear under a new run URL.
- Regression: compiled browser negative flow waits 5500ms, sees one 404 request,
  no Loading message, safe other missing-ID screens, handled API network failure
  and correct legacy host redirect, with no unhandled browser exception.
- Commit: `fix(hunt): stop polling terminal run errors`.

## Final environment and source control

Chromium **156.0.8078.4**, Playwright Chromium, compiled Next.js 16.4.2.
Viewports: **1920×1080, 1366×768, 390×844**. Original compiled Docker application
on port 3000 and successive compiled source builds on 3103 were exercised. The
source app uses existing account data only for the explicitly created E2E objects.
Registration/legacy UI tests and the full suite use disposable databases/apps.
A separate audit worker and Redis queue execute only local Docker `.test` fixtures.

Starting main was `f77f4db`. Concurrent work committed `a8d7e35` on the initial
branch and another process merged it upstream as `13f7529` before audit completion.
At the user's request that work is separate: this final audit branch starts from
`c54fdfc`, excludes the concurrent commit, and is named
`test/deep-e2e-app-audit-final`. The existing upstream merge is preserved, not
reverted or rewritten. Its separate six authentication-origin tests are validated
when checking the actual upstream content.

The concurrent cleanup also stashed local files and removed a temporary worktree.
Only this audit's test drivers were recovered from that stash into the final
worktree. The stash was neither applied nor dropped; preexisting `rapport-audit.md`
and `recon/` remain preserved in that external cleanup's stash. Their content was
not edited by this audit.

## Coverage results

| Feature | Actual scenario | Result | Notes |
| --- | --- | --- | --- |
| Anonymous | Root, 12 private URLs, reload | PASS | Login return path preserved |
| Authentication | Incorrect password, unknown account, supplied valid E2E account | PASS | Generic rejection; successful real session |
| Session cookie | Attributes only | PASS | HttpOnly, SameSite=Lax; Secure=false on local HTTP; values never printed |
| Login redirects | Internal destination and intercepted external destination | FIXED | Relative return works; foreign navigation refused before network |
| Login outage | Aborted credentials callback | FIXED | No unhandled rejection; safe error and button restored |
| Logout/multi-tab | Logout, private route, second tab without refresh | FIXED | Includes mount/hydration race regression |
| Registration | Actual form, auto-login, duplicate, empty Targets | PASS | Generated account in disposable DB; deleted afterward |
| Navigation | All five menu links, direct routes, history, reload | PASS | Root/login/register/Target/Scope/Recon/Hunt/Settings |
| Targets | Required name/UA, platform, four rewards and currency | PASS | Actual Create Target form and backend persistence |
| Target editing | Company/reward/UA changes and reload | PASS | Future captured HTTP uses edited UA |
| Scope | Add/edit/remove/re-add, normalization and duplicates | PASS | UI and API; historical technical identity retained |
| Invalid scope | Scheme, path, whitespace, malformed FQDN | PASS | Expected 400/409 and safe UI messages |
| Wildcard/out-of-scope | Wildcard plus explicit admin exclusion | PASS | Excluded concrete host and wildcard not selectable for scans |
| Ownership | Actual second-owner fixture across APIs | PASS | Read/edit/credentials/reports/scan return 404; fixture removed |
| Credentials | UI add, purpose edit, refresh, delete | PASS | Independent generated local-fixture secrets, not BugHunter credentials |
| Credential privacy | Saved metadata and cleared inputs | PASS | No raw cookie/token/password/ciphertext in saved UI/API |
| Readiness | Public XSS without credentials | FIXED | Actual anonymous public Recon enables READY |
| Readiness gaps | BOLA identities, JWT, absent XML/OAuth | PASS | BOLA/JWT BLOCKED; XML/OAuth NOT_APPLICABLE after discovery |
| Recon | Fresh local run, logs/history/status, reload, finish | PASS | Internal HTTP, httpx, Katana, DNS, TCP-only Nmap |
| User-Agent/scope | Actual server captures | PASS | First pipeline 105 requests; final source pipeline 117 exact-UA requests, zero foreign-host requests |
| Hunt policy | Fresh subset, empty and excluded-policy runs | PASS | Central selected families and immutable snapshots checked |
| Hunt engine | Applicability, skips, bounds, candidates | PASS | Actual local safe techniques; blocked family does not stop others |
| False positives | DOM sink names, literal/escaped SSTI, catch-all | PASS | Weak observations never confirmed; supplementary runtime controls also pass |
| Timing | Explicit approved SQLi timing on harmless fixture | PASS | No confirmed SQLi from no/single delay; jitter controls supplementary tests |
| Approvals | Default off, refresh, explicit consent, forbidden IDs | PASS | Per-run only; next Hunt inherits no approval |
| Double submit | Double click Start Hunt | PASS | One created approved run |
| Worker outage | Queued + reload, stop/start isolated worker | PASS | Run resumes; production worker untouched |
| Historical scope | Remove scanned host, reject new Hunt, read history | PASS | Scan/Finding/report references survive; re-add new active identity |
| Findings | Signal creation, actual confirmed fixture BOLA, refresh | PASS | Signal/Candidate/Validated/Confirmed remain distinct |
| Reports | Unpassed rejection, manual gate, generate/preview/reload | FIXED | Owned report history restores saved preview |
| Local export | Controlled fixture markdown exported locally | PASS | No external report submission; no dedicated UI download button claimed |
| Settings | Direct/menu/reload/responsive/form labels | PASS | Read-only; existing providers/secrets not overwritten |
| Errors | Bad IDs, legacy host redirect, API failure | PASS | No stack/Prisma/ciphertext in UI |
| Hunt missing ID | Wait beyond polling interval | FIXED | One 404, no contradictory Loading state |
| Health | Real disposable Redis outage | FIXED | 503 in 11–12ms in real smoke; 1500ms deadline tested for hung dependencies |
| Responsive | Required three widths across primary screens | PASS | No horizontal overflow with tested fixture data |
| Accessibility | Tab order, masking, eight missing form names | FIXED | Findings/Report/Settings/Recon/Hunt now zero missing control names |
| Console/API | Error categories and HTTP paths collected | PASS | No unexplained hydration/key/page error or application 500 in completed runs |

The new drivers record **126 successful browser checks** across authentication,
core workflow, details, ownership/credentials, history/approvals, accessibility,
negative routes and registration, plus separate readiness and health scenarios.
Existing browser workflows were also exercised. These counts describe recorded
checks, not exhaustive certification or a claim that all vulnerability techniques
were positively exploited.

## Redirect audit

Corrected external callbackUrl navigation. Verified private-route return paths,
legacy `/targets/{technicalHostId}` → `/hosts/{technicalHostId}`, host breadcrumbs,
post-create program detail and post-Hunt run detail. The canonical AUTH_URL origin
explains localhost versus alternate-loopback logout in the original deployment.
The separately authored public-origin change remains separately attributed.

Authenticated `/dashboard`, `/findings` and `/reports` are absent global pages and
return 404; no current menu points at them. Actual Findings/Report flows are under
`/targets/{technicalHostId}/findings` and `/targets/{technicalHostId}/report`.
These missing global features are documented, not invented or marked as tested UI.

## Console/API errors

Expected errors were deliberately generated: wrong login, invalid/duplicate hosts,
missing and foreign IDs, rejected approval, unpassed report finding, simulated API
outage and isolated Redis failure. The absent global pages produce expected
resource/console 404 entries during their checks. No unexplained application 500,
hydration warning, React key warning or unhandled page exception remains in the
completed scenarios. Login rejection and missing-Hunt polling defects are fixed.

Repeated auth runs reached the rate limit on the disposable audit Redis. Only
that isolated service's test login counter was reset before reruns. No production
rate-limit keys were changed or rate limiter disabled. Final full auth run passes.
Diagnostics store categories/paths rather than request headers, payloads, raw
console text or stack traces that might expose secrets.

## Recon and Hunt

Local Node HTTP fixtures use reserved `.test` Docker-network aliases. No Internet
target or unauthorized private service was scanned. The HTTP-only fixture's own
technical `scheme` was set to `http` during guarded fixture setup; the current
normal FQDN-only Scope form has no scheme selector. TLS verification was not weakened.

All recorded requests use the program UA, including edited-UA future runs and
explicit fixture login. Foreign links and redirects never authorize another host.
DNS and TCP-only Nmap are USER_AGENT_NOT_APPLICABLE. Full real network tests also
capture httpx, Katana, Nuclei, Dalfox, TypeScript HTTP and controlled Chromium;
Dalfox's historical JSON-config parsing error is absent.

Hunt freezes policy/approvals per run, executes READY and safe DEGRADED subsets,
skips BLOCKED/not-applicable methods visibly, and respects request/technique budgets.
The fixture intentionally exposes a harmless two-account object-access defect for
positive confirmation. Literal SSTI and DOM sink observations do not become confirmed
findings. Approved timing probes against the harmless no-delay fixture do not
confirm SQLi. Paired timing/jitter and CMDi edge cases additionally pass deterministic
regression tests; no live vulnerable SQL/CMDi backend is claimed.

No state-changing business action, reverse shell, arbitrary shell, destructive
payload, persistence, credential theft, unrestricted metadata/LAN probing or
third-party exploit execution occurred. The sole local fixture login POST is an
explicitly approved synthetic test-session action.

## Findings, Reports and persistence

Create/edit → reload is checked for Target/rewards/UA and host identities. Scan →
reload is checked queued/running/completed, including worker recovery. Removed-host
history remains readable and refuses new scans. Actual confirmed local BOLA and
manually added Signal records retain their evidence levels after refresh. The
manual gate remains distinct from technical confirmation. Reports now reload
owned saved previews; controlled fixture markdown was exported to a local artifact.
No report was submitted to a platform.

After all checks, a guarded cleanup removed **3 audit-created programs and 20
associated E2E host identities**, including their temporary test artifacts. Both
timestamp markers and the known audit owner were required. Non-audit host identities
were verified unchanged. The separate foreign-user fixture and generated registration
account were removed; no existing user/account/Target/report was deleted for testing.
The product soft-delete/history assertions were completed before this deliberate
E2E-only cleanup. Existing production services and volumes were not reset or restarted.

## Final validation

- Isolated audit content: **183 tests / 27 suites passed, zero skipped**.
- Actual upstream content including the separately authored origin tests:
  **189 tests / 28 suites passed, zero skipped**.
- `SCANNER_HTTP_TESTS=1` and disposable PostgreSQL explicitly enable all optional
  network/integration cases; no old test was deleted or disabled to obtain green.
- New real Chromium drivers and existing Target/Hunt browser workflows pass.
- Lint, TypeScript, Next build, Compose config and `git diff --check`: pass.
- Fresh-worktree Next route types generated before TypeScript as required by this
  Next version. Prisma migration diff: no difference. **No new migration.**

Driver secrets are consumed only in memory. No video, trace, browser storage-state,
cookie/token dump, password screenshot or E2E credential file is created. Missing
E2E_EMAIL/E2E_PASSWORD exits explicitly before attempting authentication. Ordered
full-data drivers: deepWorkflow → deepReadiness → deepInteractions → deepDetails →
deepAccessibility/deepErrors → deepHistory (host removal last). Use only their
explicit local fixture/disposable app endpoints and isolated worker/queue.

## Remaining limitations / NOT_TESTED

- Live HTTPS browser deployment/cookie Secure behavior. The separate origin tests
  are in-process Auth.js requests; their IP/domain strings are not contacted.
- Real OAuth consent, operator OOB callbacks, XML exploitation, positive SQL/CMDi
  backend, external programs or replay of historical external scan candidates.
- Cancellation, Quick/Deep/continuous Recon, asynchronous approval modal/rejection/
  expiry: no current controls or API. Current approval is a per-run checkbox.
- Global Findings/Reports pages, dedicated finding-detail/filter/download UI: absent.
- Mutating the user's existing AI-provider settings or making real provider calls.
- Persisting login across browser-process restart: session tokens were never saved
  to disk. Same-context tabs, history, reload and hard refresh were exercised.
- Full WCAG/assistive-technology certification or every possible long-content layout.

## Commits and delivery

All correction phases were tested, committed and pushed before the next correction.

| Commit | Correction |
| --- | --- |
| `3252304` | Route inventory and compiled auth/navigation baseline |
| `c950065` | Bounded health dependency failures |
| `8cb9e11` | Internal login destinations |
| `91e2659` | Login network recovery |
| `c759e27` | Cross-tab logout |
| `76d6804` | Persistent report history/preview |
| `2d19961` | Observed public XSS readiness |
| `f260236` | Session hydration race |
| `13f346f` | Accessible Findings/Report control names |
| `c54fdfc` | Terminal Hunt polling/error state |

Final drivers/report are committed separately on `test/deep-e2e-app-audit-final`.
Concurrent `a8d7e35` and upstream `13f7529` are preserved as existing work, separate
from this audit branch. The final delivery message records the last audit commit,
merge and exact verified origin/main hash. No force push or history rewriting.

The preexisting Hunt UI smoke uses a labelled report fixture. Actual new Recon/Hunt
execution evidence comes from deepWorkflow/deepReadiness/deepHistory, not that UI
fixture. Fresh worktree dependency copies were physical: an earlier symlink-based
build was correctly rejected by Turbopack's workspace boundary and was replaced,
then route generation, TypeScript and the real build passed without a code workaround.
