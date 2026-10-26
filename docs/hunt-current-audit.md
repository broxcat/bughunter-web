# Existing Hunt audit — baseline 7645938

Inspected 2026-10-26 before implementation. `BountyProgram.qualifying` and
`nonQualifying` are string arrays edited by ProgramForm. `hunt.ts` maps 18 modules
through FAMILY_POLICY and separately gates a Nuclei Git-config template. The shared
execution context enforces selected active host and program UA. There is no Hunt
policy snapshot or readiness response. `ScanRun` records UA only; `Finding` stores
confidence (CANDIDATE/PROVEN), severity and the independent manual triage gate.

| Current family | Module | Target policy name(s) | Actual prerequisites | Current technique | False-positive controls | Gaps |
| --- | --- | --- | --- | --- | --- | --- |
| auth-bypass | auth-bypass.ts | AUTHENTICATION, ACCESS_CONTROL | Protected path; public baseline; session useful | Header/path variations on known/guessed protected routes | Content consistency, error/shell and catch-all classification | No prerequisites preview; method/path safety needs central policy |
| idor | idor.ts | IDOR, ACCESS_CONTROL | Discovered numeric/UUID/query reference; two accounts for proof | Reference discovery, numeric neighbor GET | INFO candidates; no references produces no finding | Discovery and confirmation conflated; no explicit ownership reference |
| bola | bola.ts | IDOR, ACCESS_CONTROL | Two credentials; account-A-readable object | A/B/anonymous differential | Body overlap, error shells, anonymous catch-all, content type | Two credentials do not establish independent accounts or object ownership |
| xss | xss.ts + xssConfirm.ts | XSS | Query/form input or source/sink; browser for confirmation | Canary reflection, optional Dalfox, script sink discovery, browser dialog | Reflections/sinks INFO; dialog can confirm | Context coverage sparse; budget not global; Dalfox config file is YAML with comments |
| csrf | csrf.ts | CSRF | Session cookies, state-changing form; browser for proof | Form/token/SameSite discovery; real cross-site POST | Cookie/anonymous comparison, login redirect rejection | Real mutation currently automatic; HTML forms only |
| sqli | sqli.ts | SQL_INJECTION | GET query input; session for protected input | DB-specific 3/5-second delay probes | Repeated baseline, variance, second delay must track | Samples grouped rather than interleaved; noisy candidates MEDIUM |
| command-injection | commandInjection.ts | RCE | Suitable discovered query input | Bounded sleep with shell separators | Same repeated timing and second-delay controls | Grouped samples; noisy candidates MEDIUM; classify timing as approval-only |
| ssrf | ssrf.ts | SSRF | URL-like input; configured OOB for blind proof | Metadata/internal probes and token-correlated OOB | Content markers or OOB token; weak errors INFO | Cloud metadata and loopback probes violate requested safety policy; must remove |
| xxe | xxe.ts | XXE | XML path hint, session if protected, OOB for blind | POST external entity: local file or OOB | File markers or token callback | Path hint is not demonstrated XML support; file reads/mutating POST must not run automatically |
| ssti | ssti.ts | SSTI, RCE | Template-like query input | Two different arithmetic expressions per syntax | Literal reflection rejected; second arithmetic evaluation | Add negative/inert control and context applicability |
| cors | cors.ts | CORS | API/root endpoint; credentials for sensitive proof | Single arbitrary Origin plus wildcard checks | Header reflection, JSON-field heuristic | Header configuration alone promotes HIGH/MEDIUM without demonstrated sensitive access |
| jwt | jwt.ts | JWT, AUTHENTICATION | Real bearer/cookie/corpus JWT | alg:none replay, offline HMAC guesses, expiry audit | Anonymous/content differential; actual signature match | No preview; recovered secret written to evidence; secret recovery must be removed |
| oauth | oauth.ts | OAUTH, AUTHENTICATION | Observed authorization URL/flow | redirect_uri probe, absent state signal | Manual redirects; request-flow parameter checks | Missing-state MEDIUM is a signal only; use observed flow only, no grant/consent |
| lfi | lfi.ts | LFI | File/path-like input; OOB for RFI branch | System-file traversal probes and remote OOB inclusion | File markers; OOB callback | System-file retrieval unsafe; RFI branch not separately selected; callback does not prove inclusion |
| deserialization | deserialization.ts | DESERIALIZATION, RCE | Serialized value in cookie/query/hidden field | Passive format signatures | Explicit candidate; no gadget chains | Passive signature MEDIUM; token prefix exposed by redact helper |
| business-logic-race | businessLogicRace.ts | BUSINESS_LOGIC | Action endpoint, session and control read | Fifteen concurrent replays and state readback | Distinct server-generated IDs/counters; no status-only proof | Stateful burst automatic; must become approval-only/unsupported |
| business-logic-tamper | businessLogicTamper.ts | BUSINESS_LOGIC | Price/quantity/role field, often session | Changes critical values in GET/POST | Before/after access and effect checks, money stays candidate | Business mutations automatic; approval missing |
| business-logic-workflow | businessLogicWorkflow.ts | BUSINESS_LOGIC | Multi-step funnel, session, control read | GET final step from isolated session | Independent new-resource readback; ignores success text alone | GET can trigger a real action; final-step calls need approval |
| information-disclosure | Nuclei git-config.yaml | INFORMATION_DISCLOSURE | Reachable selected host | App-owned Git-config exposure GET | Status plus content marker; redirects disabled | Not in shared family list; findings not normalized to technique metadata |

`discoverCorpus` caches one in-memory crawl per scanRunId (25 pages, depth 2),
authenticated using the first credential. It retains concatenated HTML and URLs,
not structured responses/forms/cookie metadata or durable Recon results. Recon CLI
output is append-only ScanLog text. Several modules still fetch the root themselves.

`TargetCredential` already stores encrypted cookies, bearer tokens and login
credentials, with optional encrypted cached sessions. No roles/account identity
attestation or explicit object ownership is stored. Readiness must inspect metadata
without logging in or contacting a target. It must not confuse a configured login
with a fresh usable session, nor two credential rows with two independent accounts.

The requested safety controls will replace unsafe automatic branches; there will
be no approval that can silently authorize a generic destructive operation. Until
an operation can be confined, it remains unsupported. Existing scope/UA checks,
historical FKs and the manual finding gate remain in force.
