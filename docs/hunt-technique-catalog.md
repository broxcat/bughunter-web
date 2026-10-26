# Hunt technique catalogue — version 1

Reviewed 2026-10-26 against all four requested sources for every current family.
OWASP guidance and IETF standards take precedence over PortSwigger methodology;
HackTricks supplies community variations, not normative permission to execute them.
The HackTricks website returned HTTP 402, so its official GitHub source was read.
No exploit binary, dependency or third-party exploit code was downloaded/executed.

Descriptors are auditable methods, not arbitrary commands. PLANNED techniques are
not executable until an audited handler is connected. UNSUPPORTED state-changing
or high-risk techniques send no requests, regardless of client-supplied approval.
An approval UI is intentionally not offered for operations we cannot confine.
The implementation column is updated only when handlers and tests exist.

All active methods use the Target scope and UA context. Weak signals, passive
signatures, literal reflection and timing anomalies cannot yield MEDIUM/HIGH
findings. Candidate evidence is separated from independently confirmed findings.

Numeric/UUID/query/static object references are inventoried from observed routes;
JSON/nested identifiers are observed when present, never blindly mutated. Vertical
role changes and write/method variations remain manual. CSRF inventory includes
observed script API methods, not just HTML forms. SSTI uses different arithmetic
results plus inert controls. CORS header reflection alone is not sensitive impact.
JWT checks neither recover signing secrets nor change identity claims. OAuth never
initiates consent or a grant. XML support must be observed, not inferred from a name.
SSRF callback destinations come exclusively from the configured operator catcher.
Race/financial/workflow actions are reviewed without issuing the action.

## auth-bypass

| Technique | Prerequisites | Applicability | Risk | Status | Requests |
| --- | --- | --- | --- | --- | --- |
| `auth.public-baseline` — Public and error-shell baseline | Public observation | ALWAYS | PASSIVE | PLANNED | ≤ 0 |
| `auth.read-differential` — Authenticated versus anonymous content differential | Public observation | API_ENDPOINT | SAFE_ACTIVE | PLANNED | ≤ 6 |
| `auth.routing-control` — Read-only routing header with independent content control | Public observation | API_ENDPOINT | SAFE_ACTIVE | PLANNED | ≤ 6 |

Safe validation: compare independently collected responses and negative controls; store only sanitized observation metadata. Ambiguous results remain INFO candidates; status, timeout, literal reflection and passive signatures are never sufficient for confirmation.

References reviewed:

- [02-Bypassing Authorization Schema](https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/05-Authorization/02-Bypassing_Authorization_Schema.md) — OWASP_WSTG, TESTING_GUIDANCE, reviewed 2026-10-26.
- [Authorization Cheat Sheet](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Authorization_Cheat_Sheet.md) — OWASP_CHEAT_SHEET, TESTING_GUIDANCE, reviewed 2026-10-26.
- [idor](https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/idor.md) — HACKTRICKS, COMMUNITY_METHODOLOGY, reviewed 2026-10-26.
- [Web Security Academy: access-control](https://portswigger.net/web-security/access-control) — PORTSWIGGER_ACADEMY, VENDOR_METHODOLOGY, reviewed 2026-10-26.

## idor

| Technique | Prerequisites | Applicability | Risk | Status | Requests |
| --- | --- | --- | --- | --- | --- |
| `idor.reference-discovery` — Numeric and opaque references in observed URLs | Public observation | OBJECT_REFERENCE | PASSIVE | PLANNED | ≤ 0 |
| `idor.query-reference` — Query and nested reference inventory | Public observation | OBJECT_REFERENCE | PASSIVE | PLANNED | ≤ 0 |
| `idor.static-reference` — Observed static object references | Public observation | OBJECT_REFERENCE | PASSIVE | PLANNED | ≤ 0 |

Safe validation: compare independently collected responses and negative controls; store only sanitized observation metadata. Ambiguous results remain INFO candidates; status, timeout, literal reflection and passive signatures are never sufficient for confirmation.

References reviewed:

- [04-Insecure Direct Object References](https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/05-Authorization/04-Insecure_Direct_Object_References.md) — OWASP_WSTG, TESTING_GUIDANCE, reviewed 2026-10-26.
- [Insecure Direct Object Reference Prevention Cheat Sheet](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.md) — OWASP_CHEAT_SHEET, TESTING_GUIDANCE, reviewed 2026-10-26.
- [idor](https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/idor.md) — HACKTRICKS, COMMUNITY_METHODOLOGY, reviewed 2026-10-26.
- [Web Security Academy: access-control/idor](https://portswigger.net/web-security/access-control/idor) — PORTSWIGGER_ACADEMY, VENDOR_METHODOLOGY, reviewed 2026-10-26.

## bola

| Technique | Prerequisites | Applicability | Risk | Status | Requests |
| --- | --- | --- | --- | --- | --- |
| `bola.account-differential` — Two-account comparison on an explicitly owned object | PRIMARY_CREDENTIAL, SECOND_CREDENTIAL, SECOND_USER_OBJECT_REFERENCE | OBJECT_REFERENCE | SAFE_ACTIVE | PLANNED | ≤ 6 |
| `bola.anonymous-control` — Anonymous and repeated-account negative controls | PRIMARY_CREDENTIAL, SECOND_CREDENTIAL, SECOND_USER_OBJECT_REFERENCE | OBJECT_REFERENCE | SAFE_ACTIVE | PLANNED | ≤ 6 |

Safe validation: compare independently collected responses and negative controls; store only sanitized observation metadata. Ambiguous results remain INFO candidates; status, timeout, literal reflection and passive signatures are never sufficient for confirmation.

References reviewed:

- [02-API Broken Object Level Authorization](https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/12-API_Testing/02-API_Broken_Object_Level_Authorization.md) — OWASP_WSTG, TESTING_GUIDANCE, reviewed 2026-10-26.
- [Authorization Cheat Sheet](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Authorization_Cheat_Sheet.md) — OWASP_CHEAT_SHEET, TESTING_GUIDANCE, reviewed 2026-10-26.
- [idor](https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/idor.md) — HACKTRICKS, COMMUNITY_METHODOLOGY, reviewed 2026-10-26.
- [Web Security Academy: access-control/idor](https://portswigger.net/web-security/access-control/idor) — PORTSWIGGER_ACADEMY, VENDOR_METHODOLOGY, reviewed 2026-10-26.

## xss

| Technique | Prerequisites | Applicability | Risk | Status | Requests |
| --- | --- | --- | --- | --- | --- |
| `xss.reflection` — Unique reflected canary and output context | Public observation | QUERY_INPUT | SAFE_ACTIVE | PLANNED | ≤ 6 |
| `xss.dom-source-sink` — DOM sources and sinks as discovery signals | Public observation | JAVASCRIPT | PASSIVE | PLANNED | ≤ 0 |
| `xss.browser-confirmation` — Independent harmless canary execution in a confined browser | BROWSER_CONTEXT | QUERY_INPUT | SAFE_ACTIVE | PLANNED | ≤ 6 |
| `xss.stored-write` — Stored XSS write/cleanup | Public observation | ALWAYS | STATE_CHANGING | UNSUPPORTED | ≤ 0 |

Safe validation: compare independently collected responses and negative controls; store only sanitized observation metadata. Ambiguous results remain INFO candidates; status, timeout, literal reflection and passive signatures are never sufficient for confirmation.

References reviewed:

- [01-Reflected Cross Site Scripting](https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/07-Injection/01-Reflected_Cross_Site_Scripting.md) — OWASP_WSTG, TESTING_GUIDANCE, reviewed 2026-10-26.
- [Cross Site Scripting Prevention Cheat Sheet](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.md) — OWASP_CHEAT_SHEET, TESTING_GUIDANCE, reviewed 2026-10-26.
- [README](https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/xss-cross-site-scripting/README.md) — HACKTRICKS, COMMUNITY_METHODOLOGY, reviewed 2026-10-26.
- [Web Security Academy: cross-site-scripting](https://portswigger.net/web-security/cross-site-scripting) — PORTSWIGGER_ACADEMY, VENDOR_METHODOLOGY, reviewed 2026-10-26.

## csrf

| Technique | Prerequisites | Applicability | Risk | Status | Requests |
| --- | --- | --- | --- | --- | --- |
| `csrf.form-inventory` — State-changing form and simple-request inventory | Public observation | FORM | PASSIVE | PLANNED | ≤ 0 |
| `csrf.cookie-metadata` — Session SameSite and CSRF-token metadata review | Public observation | COOKIE | PASSIVE | PLANNED | ≤ 0 |
| `csrf.api-inventory` — Observed script API methods and content-type constraints | Public observation | JAVASCRIPT | PASSIVE | PLANNED | ≤ 0 |
| `csrf.submit-action` — Trigger a real state-changing CSRF action | Public observation | ALWAYS | STATE_CHANGING | UNSUPPORTED | ≤ 0 |

Safe validation: compare independently collected responses and negative controls; store only sanitized observation metadata. Ambiguous results remain INFO candidates; status, timeout, literal reflection and passive signatures are never sufficient for confirmation.

References reviewed:

- [05-Cross Site Request Forgery](https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/06-Session_Management/05-Cross_Site_Request_Forgery.md) — OWASP_WSTG, TESTING_GUIDANCE, reviewed 2026-10-26.
- [Cross-Site Request Forgery Prevention Cheat Sheet](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.md) — OWASP_CHEAT_SHEET, TESTING_GUIDANCE, reviewed 2026-10-26.
- [csrf-cross-site-request-forgery](https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/csrf-cross-site-request-forgery.md) — HACKTRICKS, COMMUNITY_METHODOLOGY, reviewed 2026-10-26.
- [Web Security Academy: csrf](https://portswigger.net/web-security/csrf) — PORTSWIGGER_ACADEMY, VENDOR_METHODOLOGY, reviewed 2026-10-26.

## sqli

| Technique | Prerequisites | Applicability | Risk | Status | Requests |
| --- | --- | --- | --- | --- | --- |
| `sqli.error-differential` — Repeated SQL-like error differential with inert control | Public observation | QUERY_INPUT | SAFE_ACTIVE | PLANNED | ≤ 6 |
| `sqli.boolean-differential` — Matched boolean responses with repeated controls | Public observation | QUERY_INPUT | SAFE_ACTIVE | PLANNED | ≤ 6 |
| `sqli.paired-timing` — Induced delays and timing distribution confirmation | Public observation | ALWAYS | HIGH_RISK | UNSUPPORTED | ≤ 0 |

Safe validation: compare independently collected responses and negative controls; store only sanitized observation metadata. Ambiguous results remain INFO candidates; status, timeout, literal reflection and passive signatures are never sufficient for confirmation.

References reviewed:

- [05-SQL Injection](https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/07-Injection/05-SQL_Injection.md) — OWASP_WSTG, TESTING_GUIDANCE, reviewed 2026-10-26.
- [SQL Injection Prevention Cheat Sheet](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.md) — OWASP_CHEAT_SHEET, TESTING_GUIDANCE, reviewed 2026-10-26.
- [README](https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/sql-injection/README.md) — HACKTRICKS, COMMUNITY_METHODOLOGY, reviewed 2026-10-26.
- [Web Security Academy: sql-injection](https://portswigger.net/web-security/sql-injection) — PORTSWIGGER_ACADEMY, VENDOR_METHODOLOGY, reviewed 2026-10-26.

## command-injection

| Technique | Prerequisites | Applicability | Risk | Status | Requests |
| --- | --- | --- | --- | --- | --- |
| `cmdi.input-discovery` — Command-shaped input inventory without executing commands | Public observation | QUERY_INPUT | PASSIVE | PLANNED | ≤ 0 |
| `cmdi.error-signature` — Existing command/parser errors as weak signals | Public observation | ALWAYS | PASSIVE | PLANNED | ≤ 0 |
| `cmdi.paired-timing` — Induced command timing/marker execution | Public observation | ALWAYS | HIGH_RISK | UNSUPPORTED | ≤ 0 |

Safe validation: compare independently collected responses and negative controls; store only sanitized observation metadata. Ambiguous results remain INFO candidates; status, timeout, literal reflection and passive signatures are never sufficient for confirmation.

References reviewed:

- [12-Command Injection](https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/07-Injection/12-Command_Injection.md) — OWASP_WSTG, TESTING_GUIDANCE, reviewed 2026-10-26.
- [OS Command Injection Defense Cheat Sheet](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.md) — OWASP_CHEAT_SHEET, TESTING_GUIDANCE, reviewed 2026-10-26.
- [command-injection](https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/command-injection.md) — HACKTRICKS, COMMUNITY_METHODOLOGY, reviewed 2026-10-26.
- [Web Security Academy: os-command-injection](https://portswigger.net/web-security/os-command-injection) — PORTSWIGGER_ACADEMY, VENDOR_METHODOLOGY, reviewed 2026-10-26.

## ssrf

| Technique | Prerequisites | Applicability | Risk | Status | Requests |
| --- | --- | --- | --- | --- | --- |
| `ssrf.url-input-discovery` — URL-like query and callback/import input discovery | Public observation | URL_INPUT | PASSIVE | PLANNED | ≤ 0 |
| `ssrf.controlled-oob` — Token-correlated callback to the configured operator catcher | OOB_CALLBACK | URL_INPUT | SAFE_ACTIVE | PLANNED | ≤ 6 |
| `ssrf.internal-probing` — Metadata, LAN or arbitrary protocol probing | Public observation | ALWAYS | HIGH_RISK | UNSUPPORTED | ≤ 0 |

Safe validation: compare independently collected responses and negative controls; store only sanitized observation metadata. Ambiguous results remain INFO candidates; status, timeout, literal reflection and passive signatures are never sufficient for confirmation.

References reviewed:

- [19-Server-Side Request Forgery](https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/07-Injection/19-Server-Side_Request_Forgery.md) — OWASP_WSTG, TESTING_GUIDANCE, reviewed 2026-10-26.
- [Server Side Request Forgery Prevention Cheat Sheet](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.md) — OWASP_CHEAT_SHEET, TESTING_GUIDANCE, reviewed 2026-10-26.
- [README](https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/ssrf-server-side-request-forgery/README.md) — HACKTRICKS, COMMUNITY_METHODOLOGY, reviewed 2026-10-26.
- [Web Security Academy: ssrf](https://portswigger.net/web-security/ssrf) — PORTSWIGGER_ACADEMY, VENDOR_METHODOLOGY, reviewed 2026-10-26.

## xxe

| Technique | Prerequisites | Applicability | Risk | Status | Requests |
| --- | --- | --- | --- | --- | --- |
| `xxe.xml-inventory` — Observed XML support and endpoint inventory | XML_ENDPOINT | XML | PASSIVE | PLANNED | ≤ 0 |
| `xxe.document-review` — Existing DOCTYPE and parser metadata review | XML_ENDPOINT | XML | PASSIVE | PLANNED | ≤ 0 |
| `xxe.controlled-oob` — POST external entity to configured catcher | Public observation | ALWAYS | STATE_CHANGING | UNSUPPORTED | ≤ 0 |
| `xxe.file-read` — External entity local-file retrieval | Public observation | ALWAYS | HIGH_RISK | UNSUPPORTED | ≤ 0 |

Safe validation: compare independently collected responses and negative controls; store only sanitized observation metadata. Ambiguous results remain INFO candidates; status, timeout, literal reflection and passive signatures are never sufficient for confirmation.

References reviewed:

- [07-XML Injection](https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/07-Injection/07-XML_Injection.md) — OWASP_WSTG, TESTING_GUIDANCE, reviewed 2026-10-26.
- [XML External Entity Prevention Cheat Sheet](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.md) — OWASP_CHEAT_SHEET, TESTING_GUIDANCE, reviewed 2026-10-26.
- [xxe-xee-xml-external-entity](https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/xxe-xee-xml-external-entity.md) — HACKTRICKS, COMMUNITY_METHODOLOGY, reviewed 2026-10-26.
- [Web Security Academy: xxe](https://portswigger.net/web-security/xxe) — PORTSWIGGER_ACADEMY, VENDOR_METHODOLOGY, reviewed 2026-10-26.

## ssti

| Technique | Prerequisites | Applicability | Risk | Status | Requests |
| --- | --- | --- | --- | --- | --- |
| `ssti.arithmetic-differential` — Two arithmetic expressions with inert and literal controls | Public observation | QUERY_INPUT | SAFE_ACTIVE | PLANNED | ≤ 6 |
| `ssti.literal-control` — Literal-reflection negative control | Public observation | QUERY_INPUT | SAFE_ACTIVE | PLANNED | ≤ 6 |

Safe validation: compare independently collected responses and negative controls; store only sanitized observation metadata. Ambiguous results remain INFO candidates; status, timeout, literal reflection and passive signatures are never sufficient for confirmation.

References reviewed:

- [18-Server-side Template Injection](https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/07-Injection/18-Server-side_Template_Injection.md) — OWASP_WSTG, TESTING_GUIDANCE, reviewed 2026-10-26.
- [Server Side Template Injection Prevention Cheat Sheet](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Server_Side_Template_Injection_Prevention_Cheat_Sheet.md) — OWASP_CHEAT_SHEET, TESTING_GUIDANCE, reviewed 2026-10-26.
- [README](https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/ssti-server-side-template-injection/README.md) — HACKTRICKS, COMMUNITY_METHODOLOGY, reviewed 2026-10-26.
- [Web Security Academy: server-side-template-injection](https://portswigger.net/web-security/server-side-template-injection) — PORTSWIGGER_ACADEMY, VENDOR_METHODOLOGY, reviewed 2026-10-26.

## cors

| Technique | Prerequisites | Applicability | Risk | Status | Requests |
| --- | --- | --- | --- | --- | --- |
| `cors.origin-matrix` — Arbitrary/null/prefix/suffix Origin matrix | Public observation | API_ENDPOINT | SAFE_ACTIVE | PLANNED | ≤ 6 |
| `cors.sensitive-comparison` — Credentialed versus anonymous content comparison | AUTHENTICATED_SESSION | API_ENDPOINT | SAFE_ACTIVE | PLANNED | ≤ 6 |

Safe validation: compare independently collected responses and negative controls; store only sanitized observation metadata. Ambiguous results remain INFO candidates; status, timeout, literal reflection and passive signatures are never sufficient for confirmation.

References reviewed:

- [07-Cross Origin Resource Sharing](https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/11-Client-side/07-Cross_Origin_Resource_Sharing.md) — OWASP_WSTG, TESTING_GUIDANCE, reviewed 2026-10-26.
- [HTML5 Security Cheat Sheet](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/HTML5_Security_Cheat_Sheet.md) — OWASP_CHEAT_SHEET, TESTING_GUIDANCE, reviewed 2026-10-26.
- [cors-bypass](https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/cors-bypass.md) — HACKTRICKS, COMMUNITY_METHODOLOGY, reviewed 2026-10-26.
- [Web Security Academy: cors](https://portswigger.net/web-security/cors) — PORTSWIGGER_ACADEMY, VENDOR_METHODOLOGY, reviewed 2026-10-26.

## jwt

| Technique | Prerequisites | Applicability | Risk | Status | Requests |
| --- | --- | --- | --- | --- | --- |
| `jwt.claims-audit` — Offline token structure and expiry metadata | JWT | JWT | PASSIVE | PLANNED | ≤ 0 |
| `jwt.validation-differential` — Changed-signature acceptance versus valid/anonymous controls | JWT | JWT | SAFE_ACTIVE | PLANNED | ≤ 6 |
| `jwt.secret-recovery` — Signing-secret guessing or recovery | Public observation | ALWAYS | HIGH_RISK | UNSUPPORTED | ≤ 0 |

Safe validation: compare independently collected responses and negative controls; store only sanitized observation metadata. Ambiguous results remain INFO candidates; status, timeout, literal reflection and passive signatures are never sufficient for confirmation.

References reviewed:

- [10-JSON Web Tokens](https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/06-Session_Management/10-JSON_Web_Tokens.md) — OWASP_WSTG, TESTING_GUIDANCE, reviewed 2026-10-26.
- [JSON Web Token Cheat Sheet](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/JSON_Web_Token_Cheat_Sheet.md) — OWASP_CHEAT_SHEET, TESTING_GUIDANCE, reviewed 2026-10-26.
- [hacking-jwt-json-web-tokens](https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/hacking-jwt-json-web-tokens.md) — HACKTRICKS, COMMUNITY_METHODOLOGY, reviewed 2026-10-26.
- [Web Security Academy: jwt](https://portswigger.net/web-security/jwt) — PORTSWIGGER_ACADEMY, VENDOR_METHODOLOGY, reviewed 2026-10-26.
- [IETF RFC 8725](https://www.rfc-editor.org/rfc/rfc8725.html) — IETF, STANDARD, reviewed 2026-10-26.

## oauth

| Technique | Prerequisites | Applicability | Risk | Status | Requests |
| --- | --- | --- | --- | --- | --- |
| `oauth.flow-inventory` — Observed OAuth flow, state and PKCE inventory | OAUTH_FLOW | OAUTH | PASSIVE | PLANNED | ≤ 0 |
| `oauth.flow-controls` — Redirect and response-type configuration observations | OAUTH_FLOW | OAUTH | PASSIVE | PLANNED | ≤ 0 |

Safe validation: compare independently collected responses and negative controls; store only sanitized observation metadata. Ambiguous results remain INFO candidates; status, timeout, literal reflection and passive signatures are never sufficient for confirmation.

References reviewed:

- [05.1-OAuth Authorization Server Weaknesses](https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/05-Authorization/05.1-OAuth_Authorization_Server_Weaknesses.md) — OWASP_WSTG, TESTING_GUIDANCE, reviewed 2026-10-26.
- [OAuth2 Cheat Sheet](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/OAuth2_Cheat_Sheet.md) — OWASP_CHEAT_SHEET, TESTING_GUIDANCE, reviewed 2026-10-26.
- [oauth-to-account-takeover](https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/oauth-to-account-takeover.md) — HACKTRICKS, COMMUNITY_METHODOLOGY, reviewed 2026-10-26.
- [Web Security Academy: oauth](https://portswigger.net/web-security/oauth) — PORTSWIGGER_ACADEMY, VENDOR_METHODOLOGY, reviewed 2026-10-26.
- [IETF RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html) — IETF, STANDARD, reviewed 2026-10-26.

## lfi

| Technique | Prerequisites | Applicability | Risk | Status | Requests |
| --- | --- | --- | --- | --- | --- |
| `lfi.path-input-discovery` — File/path-like input inventory | Public observation | FILE_INPUT | PASSIVE | PLANNED | ≤ 0 |
| `lfi.path-error-differential` — Nonexistent harmless path and error controls | Public observation | FILE_INPUT | SAFE_ACTIVE | PLANNED | ≤ 6 |
| `lfi.file-read` — System-file inclusion or remote code inclusion | Public observation | ALWAYS | HIGH_RISK | UNSUPPORTED | ≤ 0 |

Safe validation: compare independently collected responses and negative controls; store only sanitized observation metadata. Ambiguous results remain INFO candidates; status, timeout, literal reflection and passive signatures are never sufficient for confirmation.

References reviewed:

- [01-Directory Traversal File Include](https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/05-Authorization/01-Directory_Traversal_File_Include.md) — OWASP_WSTG, TESTING_GUIDANCE, reviewed 2026-10-26.
- [Input Validation Cheat Sheet](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Input_Validation_Cheat_Sheet.md) — OWASP_CHEAT_SHEET, TESTING_GUIDANCE, reviewed 2026-10-26.
- [README](https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/file-inclusion/README.md) — HACKTRICKS, COMMUNITY_METHODOLOGY, reviewed 2026-10-26.
- [Web Security Academy: file-path-traversal](https://portswigger.net/web-security/file-path-traversal) — PORTSWIGGER_ACADEMY, VENDOR_METHODOLOGY, reviewed 2026-10-26.

## deserialization

| Technique | Prerequisites | Applicability | Risk | Status | Requests |
| --- | --- | --- | --- | --- | --- |
| `serialization.cookie-signature` — Cookie format signature without storing values | Public observation | COOKIE | PASSIVE | PLANNED | ≤ 0 |
| `serialization.input-signature` — Observed query/hidden-input serialization signatures | Public observation | ALWAYS | PASSIVE | PLANNED | ≤ 0 |
| `serialization.gadget-chain` — Execute a deserialization gadget chain | Public observation | ALWAYS | HIGH_RISK | UNSUPPORTED | ≤ 0 |

Safe validation: compare independently collected responses and negative controls; store only sanitized observation metadata. Ambiguous results remain INFO candidates; status, timeout, literal reflection and passive signatures are never sufficient for confirmation.

References reviewed:

- [23-Insecure Deserialization](https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/07-Injection/23-Insecure_Deserialization.md) — OWASP_WSTG, TESTING_GUIDANCE, reviewed 2026-10-26.
- [Deserialization Cheat Sheet](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Deserialization_Cheat_Sheet.md) — OWASP_CHEAT_SHEET, TESTING_GUIDANCE, reviewed 2026-10-26.
- [README](https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/deserialization/README.md) — HACKTRICKS, COMMUNITY_METHODOLOGY, reviewed 2026-10-26.
- [Web Security Academy: deserialization](https://portswigger.net/web-security/deserialization) — PORTSWIGGER_ACADEMY, VENDOR_METHODOLOGY, reviewed 2026-10-26.

## business-logic-race

| Technique | Prerequisites | Applicability | Risk | Status | Requests |
| --- | --- | --- | --- | --- | --- |
| `business.race-inventory` — Limited-use action inventory without replay | Public observation | BUSINESS_FLOW | PASSIVE | PLANNED | ≤ 0 |
| `business.replay-review` — Observed retry/idempotency context review | Public observation | BUSINESS_FLOW | PASSIVE | PLANNED | ≤ 0 |
| `business.race-replay` — Concurrent business action replay | Public observation | ALWAYS | STATE_CHANGING | UNSUPPORTED | ≤ 0 |

Safe validation: compare independently collected responses and negative controls; store only sanitized observation metadata. Ambiguous results remain INFO candidates; status, timeout, literal reflection and passive signatures are never sufficient for confirmation.

References reviewed:

- [04-Process Timing](https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/10-Business_Logic/04-Process_Timing.md) — OWASP_WSTG, TESTING_GUIDANCE, reviewed 2026-10-26.
- [Business Logic Security Cheat Sheet](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Business_Logic_Security_Cheat_Sheet.md) — OWASP_CHEAT_SHEET, TESTING_GUIDANCE, reviewed 2026-10-26.
- [race-condition](https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/race-condition.md) — HACKTRICKS, COMMUNITY_METHODOLOGY, reviewed 2026-10-26.
- [Web Security Academy: race-conditions](https://portswigger.net/web-security/race-conditions) — PORTSWIGGER_ACADEMY, VENDOR_METHODOLOGY, reviewed 2026-10-26.

## business-logic-tamper

| Technique | Prerequisites | Applicability | Risk | Status | Requests |
| --- | --- | --- | --- | --- | --- |
| `business.critical-field-inventory` — Quantity/price/role/plan field inventory | Public observation | BUSINESS_FLOW | PASSIVE | PLANNED | ≤ 0 |
| `business.value-review` — Observed server/client value-trust assumptions | Public observation | BUSINESS_FLOW | PASSIVE | PLANNED | ≤ 0 |
| `business.value-mutation` — Mutate financial or authorization fields | Public observation | ALWAYS | STATE_CHANGING | UNSUPPORTED | ≤ 0 |

Safe validation: compare independently collected responses and negative controls; store only sanitized observation metadata. Ambiguous results remain INFO candidates; status, timeout, literal reflection and passive signatures are never sufficient for confirmation.

References reviewed:

- [01-Business Logic Data Validation](https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/10-Business_Logic/01-Business_Logic_Data_Validation.md) — OWASP_WSTG, TESTING_GUIDANCE, reviewed 2026-10-26.
- [Business Logic Security Cheat Sheet](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Business_Logic_Security_Cheat_Sheet.md) — OWASP_CHEAT_SHEET, TESTING_GUIDANCE, reviewed 2026-10-26.
- [business-logic-vulnerabilities](https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/business-logic-vulnerabilities.md) — HACKTRICKS, COMMUNITY_METHODOLOGY, reviewed 2026-10-26.
- [Web Security Academy: logic-flaws](https://portswigger.net/web-security/logic-flaws) — PORTSWIGGER_ACADEMY, VENDOR_METHODOLOGY, reviewed 2026-10-26.

## business-logic-workflow

| Technique | Prerequisites | Applicability | Risk | Status | Requests |
| --- | --- | --- | --- | --- | --- |
| `business.workflow-inventory` — Observed multi-step route sequences | Public observation | BUSINESS_FLOW | PASSIVE | PLANNED | ≤ 0 |
| `business.transition-review` — Review transition ordering without calling final actions | Public observation | BUSINESS_FLOW | PASSIVE | PLANNED | ≤ 0 |
| `business.skip-final` — Call a final workflow action out of order | Public observation | ALWAYS | STATE_CHANGING | UNSUPPORTED | ≤ 0 |

Safe validation: compare independently collected responses and negative controls; store only sanitized observation metadata. Ambiguous results remain INFO candidates; status, timeout, literal reflection and passive signatures are never sufficient for confirmation.

References reviewed:

- [06-Circumvention of Work Flows](https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/10-Business_Logic/06-Circumvention_of_Work_Flows.md) — OWASP_WSTG, TESTING_GUIDANCE, reviewed 2026-10-26.
- [Transaction Authorization Cheat Sheet](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Transaction_Authorization_Cheat_Sheet.md) — OWASP_CHEAT_SHEET, TESTING_GUIDANCE, reviewed 2026-10-26.
- [business-logic-vulnerabilities](https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/business-logic-vulnerabilities.md) — HACKTRICKS, COMMUNITY_METHODOLOGY, reviewed 2026-10-26.
- [Web Security Academy: logic-flaws](https://portswigger.net/web-security/logic-flaws) — PORTSWIGGER_ACADEMY, VENDOR_METHODOLOGY, reviewed 2026-10-26.

## information-disclosure

| Technique | Prerequisites | Applicability | Risk | Status | Requests |
| --- | --- | --- | --- | --- | --- |
| `disclosure.git-head` — Minimal Git HEAD exposure with catch-all controls | Public observation | ALWAYS | SAFE_ACTIVE | PLANNED | ≤ 6 |
| `disclosure.header-inventory` — Observed diagnostic/security-header metadata | Public observation | ALWAYS | PASSIVE | PLANNED | ≤ 0 |

Safe validation: compare independently collected responses and negative controls; store only sanitized observation metadata. Ambiguous results remain INFO candidates; status, timeout, literal reflection and passive signatures are never sufficient for confirmation.

References reviewed:

- [04-Review Old Backup and Unreferenced Files for Sensitive Information](https://github.com/OWASP/wstg/blob/master/document/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management/04-Review_Old_Backup_and_Unreferenced_Files_for_Sensitive_Information.md) — OWASP_WSTG, TESTING_GUIDANCE, reviewed 2026-10-26.
- [Error Handling Cheat Sheet](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Error_Handling_Cheat_Sheet.md) — OWASP_CHEAT_SHEET, TESTING_GUIDANCE, reviewed 2026-10-26.
- [Web vulnerabilities methodology — information gathering](https://github.com/HackTricks-wiki/hacktricks/blob/master/src/pentesting-web/web-vulnerabilities-methodology.md) — HACKTRICKS, COMMUNITY_METHODOLOGY, reviewed 2026-10-26.
- [Web Security Academy: information-disclosure](https://portswigger.net/web-security/information-disclosure) — PORTSWIGGER_ACADEMY, VENDOR_METHODOLOGY, reviewed 2026-10-26.

## CLI integration

Dalfox v2.13.0 uses JSON (`cmd/root.go`, `loadConfigFile` / `json.Unmarshal`).
Its wrapper uses a dedicated `dalfox-config.json`, never the commented YAML used
by the ProjectDiscovery tools. A real local-server smoke test asserts the exact
Target UA and absence of a configuration parse error in captured output.

Tool source: [Dalfox v2.13.0 configuration loader](https://github.com/hahwul/dalfox/blob/v2.13.0/cmd/root.go).
