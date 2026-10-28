# Burp request transport, status attribution and Proxy History

## Findings before modification

`bughunter_burp` has three passive tools: `burp_status`, `burp_history` and
`burp_save_observation`. An approved **host** console additionally exposes
`send_http1_request` and `send_http2_request`; a passive program console does not.
The separately named `burp` server exposes the official inventory through the
scope relay. These inventories must not be confused.

The old host bridge (`console-burp-main.mjs`) validated the request with
`enforceHttp1`/`enforceHttp2`, then invoked the official PortSwigger tools through
`withOfficialBurp`. The extension constructs an `HttpService(host, port, TLS)` and
calls Montoya `api.http().sendRequest`, with `HttpMode.HTTP_2` for HTTP/2. This is
an **extension HTTP client**, not a client of the proxy listener on 8080. Such
traffic does not enter **Proxy History** automatically. It can exist in Logger;
claiming that Proxy History must contain it was incorrect.

There is **no HTTP-502 generator in BugHunter**. The precise attribution defect
was `burp-active.mjs::activeObservation`: it returned a redacted substring of
Montoya's `HttpRequestResponse{httpRequest=..., httpResponse=...}` diagnostic
string without an explicit HTTP status, transport result or response origin.
`burp-proxy.mjs::withOfficialBurp` also collapsed many failures into UNAVAILABLE.
Neither turns a failed transport into a synthesized HTTP response.

The two historical 502 records were inspected read-only. They belong to a
**different authorized host** than the host requested for this validation. Both
contain an actual `httpResponse=HTTP/2 502 Bad Gateway`, `Content-Length: 0` and a
Date header. Their saved evidence is insufficient to determine which upstream
component generated that response. They cannot honestly be described as proven
BugHunter-generated or target-generated 502s.

On the requested host, official **unwrapped SDK** calls returned 200 for both
HTTP tools before the change, and the standalone old bridge also returned 200.
Proxy History remained empty for those Montoya requests, as expected. Native
Codex calls through the old bridge sometimes reported generic unavailability or
timeout; those are MCP failures, not HTTP responses.

Sources: the exact audited [official extension implementation](https://github.com/PortSwigger/mcp-server/blob/ff10ffe6df163fb8519aadb4c26da4eb5d8ebe2b/src/main/kotlin/net/portswigger/mcp/tools/Tools.kt),
and the [Montoya API](https://portswigger.github.io/burp-extensions-montoya-api/javadoc/burp/api/montoya/http/Http.html).

## Corrected path

```text
Codex / MCP stdio
  → normalize destination and validate exact approved host/service
  → exclusions + passive/active permission + required User-Agent
  → existing installed curl, through the configured Burp proxy
  → origin response
  → independently query official MCP Proxy History by requestId
```

`burp-transport.mjs::sendViaBurpProxy` is shared by both scoped MCP entry points.
HTTP/1 and TLS HTTP/2 sends now traverse the **actual proxy listener**, so each
send is one target request with real Proxy History capture. No second request is
sent to manufacture history, and no synthetic history record is written.
Repeater and other allowed official tools retain their native MCP execution.
For compatibility, legacy **cleartext HTTP/2** keeps its Montoya path and is
explicitly labelled `historyCapture: false`; it does not promise Proxy History.

The configured endpoints remain `127.0.0.1:8080` and `127.0.0.1:9876` in the
already shared namespace. There are **no Compose, Dockerfile, network, listener
or database changes**. The installed curl supports HTTP/2; no tool is downloaded
at console startup. HTTP/2 success requires curl to report negotiated version 2;
a fallback to HTTP/1 is not mislabelled HTTP/2.

For HTTPS, the bridge retrieves the public CA from Burp's internal `http://burp/cert`
site **through the configured 127.0.0.1 proxy socket**. This special HTTP Host is
not a Docker hostname lookup and never replaces `BURP_PROXY_HOST`. The CA is
validated as a CA, held in a private temporary directory, used with `--cacert`
and removed in `finally`. TLS certificate/hostname validation remains enabled;
SNI and authority are derived from the approved destination, not the proxy.

Curl receives no shell command string. Sensitive headers, URL query and method
configuration go through stdin; request bodies use a private temporary file.
Their contents never enter argv or logs. `-q` disables curlrc files, explicit
`--proxy`/`--noproxy ''` prevent inherited proxy bypass, redirects and automatic
retries are absent, timeouts and output size are bounded. On cancellation the
owned child is stopped. The existing scope framing/UA validators remain in use;
HTTP/2 headers also reject control characters, and explicit exclusions apply to
both protocols, including the legacy path.

Bridge diagnostics/history reuse the existing bounded SSE client directly at
the official endpoint instead of starting a new Java VM for every read. The
separate official-inventory relay retains the pinned Java proxy. This avoids
conflating Java startup failures with a remote HTTP response.

## Results and errors

A successful HTTP transaction, including an actual HTTP 502, has:

```json
{"transport":"BURP_PROXY","transportResult":"TARGET_HTTP_RESPONSE","remoteStatus":200,"protocol":"HTTP/2","responseOrigin":"PROXIED_HTTP_RESPONSE","requestId":"..."}
```

`PROXIED_HTTP_RESPONSE` deliberately does not assert that a specific upstream
application generated the status. An intermediary may return an HTTP error.
`historyCapture: true` identifies the proxy capture path; the subsequent MCP
lookup is the independent proof of persistence. The raw response is bounded,
redacted and untrusted; it never creates a Finding automatically.

Internal errors are MCP errors with **`remoteStatus: null`**, never fabricated
HTTP status lines. Codes include `BURP_PROXY_UNREACHABLE`,
`BURP_PROXY_CA_UNAVAILABLE`, `BURP_MCP_UNAVAILABLE`, `BURP_TOOL_ERROR`,
`TARGET_DNS_FAILURE`, `TARGET_CONNECT_FAILURE`, `TARGET_TLS_FAILURE`,
`TARGET_TIMEOUT`, `TARGET_CANCELLED`, `TARGET_PROTOCOL_UNSUPPORTED` and
`UPSTREAM_LIMIT`. A 502 from the CONNECT phase is a tunnel failure, not a target
HTTP 502; its `proxyConnectStatus` is retained separately. Behind a proxy, target
DNS failures may only be observable as a CONNECT failure, not a provable DNS error.

Structured stderr events contain only `requestId`, `targetId`,
`destinationHost`, `destinationPort`, `protocol`, `proxyHost`, `proxyPort`,
`mcpHost`, `mcpPort`, `mcpTool`, `transportResult` and `remoteStatus` (plus a
CONNECT status on failure). They contain no headers, cookies, Authorization,
body, query, credentials or raw curl/Java diagnostics. MCP stdout stays JSON-RPC.

`burp_history` now accepts an optional UUID `requestId`. The official regex tool
performs a bounded correlation search; the parser still independently validates
host/scope and extracts only redacted metadata. Regex injection is rejected.
No discovery or matching requestId grants authorization to another host.

## Validation

The real requested HTTPS root was read with the configured User-Agent, one
HTTP/1.1 request and one HTTP/2 request, by an authenticated **Codex CLI** using
`bughunter_burp`. A second natural-language Codex query retrieved both exact
requests through the official MCP-backed `burp_history`:

| Protocol | remoteStatus | requestId | Official Proxy History | Required UA |
| --- | --- | --- | --- | --- |
| HTTP/1.1 | 200 | `8dcf4b70-0c8d-4f22-b8cf-a138a7ade497` | 200, same requestId | matched |
| HTTP/2 | 200 | `0b37c5c8-9158-4468-ac46-c2ed28e98b71` | 200, same requestId | matched |

The first ephemeral CLI probe made the successful calls but stalled before its
final prose and was interrupted. The follow-up history-only CLI run completed
normally and confirmed both records; no extra target request was sent for that
follow-up. Full transcripts/HTML remain private and are not committed. The
requested internal hostname and User-Agent value are omitted here; matching was
checked against the immutable configured target policy.

Direct official SDK/MCP calls also returned 200 in both protocols. **Raw Java
stdio directly from native Codex was tested and failed at handshake (one run
closed during initialize, another timed out), before any target HTTP response.**
That separate interoperability limitation is not presented as fixed or as a 502.
The scoped BugHunter path and its official history reads above are operational.

A disposable full app/console/Burp acceptance stack also uses a local dual
HTTP/1.1 + HTTP/2 TLS origin. Native Codex `mcpServer/tool/call` sends each
protocol through the bridge, then retrieves its UUID from real official Proxy
History and verifies status/UA. Existing browser, private-network, reconnect,
program-passive, deletion and shared-server survival scenarios pass as well.
No program scans, exploitation or other hosts were exercised.

Commands executed:

- `npm test`: 535 passed; 145 infrastructure/network tests skipped here.
- `TEST_POSTGRES_TMPFS=1 TMPDIR=/dev/shm node tests/queue/runInfrastructure.mjs`:
  674 passed with real PostgreSQL/Redis, 6 network tests skipped; existing Prisma
  migrations/additive upgrade passed. No new migration is needed.
- `npm run test:network`: 6 passed, completing all 680 tests across these runs.
- `npx vitest run tests/unit/burpTransport.test.ts tests/unit/researchConsole.test.ts tests/unit/portSwigger.test.ts`:
  52 passed, including true 502, CONNECT-502/TLS distinction, unreachable proxy,
  UA, scope/exclusions, no retry, body framing and curlrc/NO_PROXY bypass prevention.
- `RESEARCH_REAL_BURP_IMAGE=bughunter-burp:official RESEARCH_TEST_APP_IMAGE=bughunter-web:latest RESEARCH_TEST_RUNNER_IMAGE=bughunter-research:502-test node --import tsx tests/research/runConsole.mjs`:
  real HTTP/1.1 + HTTP/2 + MCP + native Codex + Proxy History and browser regressions passed.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`: passed.
- `docker compose build research-console`: passed, existing prerequisites reused.
- Authenticated `bughunter-codex exec` natural-language root-read and history queries:
  live evidence in the table above.

The validated runtime files were applied to the running console and its image
rebuilt. Only the requested host's tmux pane was resumed with its existing
conversation. Burp, its namespace/listeners and in-memory history were retained;
other target consoles were left running. Existing processes in other consoles
load the new runtime on their next normal launch.

Changed files:

- `docker/research/validator/burp-transport.mjs` (new), `burp-active.mjs`,
  `burp-http.mjs`, `burp-service.mjs`, `console-burp-main.mjs`,
  `portswigger-policy.mjs`, `portswigger-main.mjs`.
- `tests/unit/burpTransport.test.ts` (new), `tests/unit/portSwigger.test.ts`,
  `tests/research/runConsole.mjs`, `tests/research/portSwiggerAcceptance.mjs`.
- This report and `docs/PORTSWIGGER-MCP.md`.
