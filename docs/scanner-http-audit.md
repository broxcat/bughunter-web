# Target HTTP execution audit

Hunt catalogue update: this table documents the lower-level wrappers. Current
bounded Hunt does not invoke external CLIs or the former CSRF action replay.
It uses the internal shared corpus, request guard and catalogue described in
[hunt-readiness.md](hunt-readiness.md). Credential login requires explicit action;
normal scans only consume fresh cached sessions. Dalfox uses its own JSON config.

Audited against the repository wrappers and installed `--help`, 2026-10-26.

Business Target = `BountyProgram`. A technical `Target` remains a historical host
identity. HTTP execution always requires an active, concrete host, an owned
program, an APPROVED internal Scope and a nonempty required User-Agent. Explicit
out-of-scope rules win. Wildcards are membership rules, never expanded or executed.

The API checks authorization before enqueue. The worker reloads configuration
immediately before execution, records `ScanRun.requiredUserAgent`, then runs the
scan in `withTargetExecution`. No queue payload or scanner selects the UA.
`loadScanContext` also checks current authorization. Program edits affect future
executions, including jobs still queued. Historical scans keep their recorded UA;
pre-migration scans have no invented value.

| Component | HTTP behavior / enforcement |
| --- | --- |
| TypeScript `probe` | `executionHeaders` replaces UA case-insensitively. Exact selected host (including port), HTTP(S) only, no URL credentials, redirects manual. Missing context sends nothing. |
| httpx v1.12.0 | Official `-H 'User-Agent: …'`, `-random-agent=false`, `-nfs`, `-duc`; no redirect following. |
| Katana v1.8.0 | Official `-H`, `-dr`, `-fs fqdn`, exact-host `-cs` regex, `-duc`. External discoveries may appear in output but never become authorized hosts. |
| Nuclei v3.11.1 | Official `-H`, `-dr`, `-ni`, `-pt http`, `-duc`. Only app-owned `templates/git-config.yaml` executes, and only when INFORMATION_DISCLOSURE is allowed. Arbitrary templates could invoke other hosts/protocols/families, so the unrestricted sweep is replaced with this audited template. |
| Dalfox v2.13.0 | Official `--user-agent`; conflicting header/agent arguments removed. `--skip-headless` and `--skip-bav`: browser verification is handled by BugHunter's controlled Chromium path, and unrelated families cannot run implicitly. No follow-redirects flag or remote payload sources. |
| Chromium: XSS confirmer | Shared `newTargetBrowserContext`; UA set at creation and forced again on every routed HTTP request; service workers blocked, WebSockets closed, foreign destinations aborted. HTTP redirects are returned with their original status and Location moved to `x-bughunter-redirect-location`, preventing Chromium from following an un-intercepted redirect chain. Login flows requiring a further redirect response to establish their cookie are unsupported; cookies set on the login POST are preserved. |
| Chromium: CSRF PoC | Same shared context. Attacker HTML is fulfilled in-process at a synthetic origin; no request goes to that foreign host. Target POSTs carry the required UA. |
| Chromium: credential auto-login and credential test API | Same shared context. Login URL must match selected host. Redirects/subresources to other hosts are blocked. Ad-hoc login test reloads owned Target configuration itself. |
| DNS resolution (`resolveAny`) | USER_AGENT_NOT_APPLICABLE: DNS, no HTTP. Results are discoveries only. |
| Nmap | USER_AGENT_NOT_APPLICABLE: `-sT -Pn -n`, TCP connect only. Removed `-sV` because service detection includes application/HTTP probes without a guaranteed program UA. |
| Subfinder | Installed but no longer invoked: passive provider HTTP does not expose a reliable program UA mechanism. Replaced in Recon by DNS-only resolution. No discovered host is scanned automatically. |
| dnsx, ffuf, gau | Present in Docker image; no runtime invocation in this repository. No HTTP execution path to configure. New wrappers must use the same Target execution context and receive real HTTP capture tests before activation. |
| Brain/LLM provider client (`fetch`) | Application control traffic to configured AI providers, not a Target scan. Provider authentication remains separate. |
| Browser-to-BugHunter API fetch / OOB catcher | Application UI traffic / inbound requests; not outbound Target scanning. |
| Docker downloads / template installation | Build-time dependencies, not Target execution. |

All 18 Hunt modules use `probe` for direct HTTP: auth-bypass, idor, xss, ssrf,
bola, csrf, sqli, commandInjection, ssti, cors, jwt, oauth, xxe, lfi,
deserialization, businessLogicRace, businessLogicTamper, businessLogicWorkflow.
Shared discovery and timing helpers use `probe` too. XSS optionally invokes Dalfox.
Only XSS, CSRF and credential auto-login open Chromium contexts.

`FAMILY_POLICY` maps actual Hunt modules to program vulnerability families.
Empty qualifying means all supported families. An explicit non-qualifying alias
excludes the whole matching module, conservatively: ACCESS_CONTROL excludes both
IDOR and BOLA; AUTHENTICATION excludes JWT and OAuth too. Unsupported entries such
as RFI or OPEN_REDIRECT do not create scanner capabilities.

`runCommand` uses argv arrays and `shell: false`, closes stdin, overrides proposed
UA arguments centrally and redacts credential headers from command summaries.
Scanner configurations are app-owned rather than loaded from an operator's home.
No decrypted credential is included in configuration summaries.

Run real local captures (binaries and Playwright Chromium required):

```sh
SCANNER_HTTP_TESTS=1 TEST_DATABASE_URL=postgresql://... npm test
```

The default suite runs HTTP client capture tests; external binary/browser tests
are opt-in so unit tests also run on machines without installed scanner tools.
These tests execute real tools, not simulated header assertions. They fail if a
tool is missing or if no HTTP request was captured.

References checked alongside installed help:
- [Nuclei traffic tagging](https://github.com/projectdiscovery/nuclei-docs/blob/main/docs/nuclei/get-started.md)
- [Nmap application probes](https://nmap.org/book/man-version-detection.html)
