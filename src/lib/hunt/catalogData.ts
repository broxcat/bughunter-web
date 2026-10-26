import type { HuntTechniqueDescriptor } from "./catalog";
import { HUNT_REFERENCES } from "./references";
export const HUNT_TECHNIQUES: HuntTechniqueDescriptor[] = [
  {
    "id": "auth.public-baseline",
    "version": 1,
    "family": "auth-bypass",
    "title": "Public and error-shell baseline",
    "prerequisites": [],
    "applicability": "ALWAYS",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["auth-bypass"]
  },
  {
    "id": "auth.read-differential",
    "version": 1,
    "family": "auth-bypass",
    "title": "Authenticated versus anonymous content differential",
    "prerequisites": [
      "AUTHENTICATED_SESSION"
    ],
    "applicability": "API_ENDPOINT",
    "risk": "SAFE_ACTIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 6,
    "candidateEvidence": "Observed input, format or reproducible response anomaly; never status alone.",
    "confirmationEvidence": "Independent positive and negative comparisons or controlled browser/OOB evidence; otherwise remain INFO candidate.",
    "negativeControls": [
      "Baseline and catch-all/error-shell rejection",
      "Repeatability; reflection is not evaluation",
      "No sensitive payload/body/token persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["auth-bypass"]
  },
  {
    "id": "auth.routing-control",
    "version": 2,
    "family": "auth-bypass",
    "title": "Read-only routing header with independent content control",
    "prerequisites": [
      "AUTHENTICATED_SESSION"
    ],
    "applicability": "API_ENDPOINT",
    "risk": "SAFE_ACTIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 6,
    "candidateEvidence": "Observed input, format or reproducible response anomaly; never status alone.",
    "confirmationEvidence": "Independent positive and negative comparisons or controlled browser/OOB evidence; otherwise remain INFO candidate.",
    "negativeControls": [
      "Baseline and catch-all/error-shell rejection",
      "Repeatability; reflection is not evaluation",
      "No sensitive payload/body/token persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["auth-bypass"]
  },
  {
    "id": "idor.reference-discovery",
    "version": 2,
    "family": "idor",
    "title": "Numeric and opaque references in observed URLs",
    "prerequisites": [],
    "applicability": "ALWAYS",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["idor"]
  },
  {
    "id": "idor.query-reference",
    "version": 2,
    "family": "idor",
    "title": "Query and nested reference inventory",
    "prerequisites": [],
    "applicability": "OBJECT_REFERENCE",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["idor"]
  },
  {
    "id": "idor.static-reference",
    "version": 1,
    "family": "idor",
    "title": "Observed static object references",
    "prerequisites": [],
    "applicability": "OBJECT_REFERENCE",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["idor"]
  },
  {
    "id": "bola.account-differential",
    "version": 2,
    "family": "bola",
    "title": "Two-account comparison on an explicitly owned object",
    "prerequisites": [
      "PRIMARY_CREDENTIAL",
      "SECOND_CREDENTIAL",
      "SECOND_USER_OBJECT_REFERENCE"
    ],
    "applicability": "OBJECT_REFERENCE",
    "risk": "SAFE_ACTIVE",
    "probeRisk": "LOW_IMPACT",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 6,
    "candidateEvidence": "Observed input, format or reproducible response anomaly; never status alone.",
    "confirmationEvidence": "Owner-attested JSON object matches across two explicit independent test identities, repeated under a second technique, and differs from independent anonymous controls.",
    "negativeControls": [
      "Explicit second-account object ownership",
      "Error/login/catch-all rejection",
      "Repeated canonical content hash, content type and object markers",
      "Anonymous comparison"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["bola"]
  },
  {
    "id": "bola.anonymous-control",
    "version": 2,
    "family": "bola",
    "title": "Anonymous and repeated-account negative controls",
    "prerequisites": [
      "PRIMARY_CREDENTIAL",
      "SECOND_CREDENTIAL",
      "SECOND_USER_OBJECT_REFERENCE"
    ],
    "applicability": "OBJECT_REFERENCE",
    "risk": "SAFE_ACTIVE",
    "probeRisk": "LOW_IMPACT",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 6,
    "candidateEvidence": "Observed input, format or reproducible response anomaly; never status alone.",
    "confirmationEvidence": "Owner-attested JSON object matches across two explicit independent test identities, repeated under a second technique, and differs from independent anonymous controls.",
    "negativeControls": [
      "Explicit second-account object ownership",
      "Error/login/catch-all rejection",
      "Repeated canonical content hash, content type and object markers",
      "Anonymous comparison"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["bola"]
  },
  {
    "id": "xss.reflection",
    "version": 2,
    "family": "xss",
    "title": "Unique reflected canary and output context",
    "prerequisites": [],
    "applicability": "QUERY_INPUT",
    "risk": "SAFE_ACTIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 6,
    "candidateEvidence": "A fresh non-secret canary appears in an authorized response.",
    "confirmationEvidence": "Separate browser canary execution is required; reflection and sink names never confirm XSS.",
    "negativeControls": [
      "Encoded/literal reflection is not execution",
      "Independent fresh execution canary"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["xss"]
  },
  {
    "id": "xss.dom-source-sink",
    "version": 1,
    "family": "xss",
    "title": "DOM sources and sinks as discovery signals",
    "prerequisites": [],
    "applicability": "JAVASCRIPT",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["xss"]
  },
  {
    "id": "xss.browser-confirmation",
    "version": 2,
    "family": "xss",
    "title": "Independent harmless canary execution in a confined browser",
    "prerequisites": [
      "BROWSER_CONTEXT"
    ],
    "applicability": "QUERY_INPUT",
    "risk": "SAFE_ACTIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 6,
    "candidateEvidence": "Observed input, format or reproducible response anomaly; never status alone.",
    "confirmationEvidence": "A fresh canary generated by the independent browser confirmer causes an observed dialog inside the scope/UA/request guard.",
    "negativeControls": [
      "Unique unpredictable canary",
      "No matching dialog means unconfirmed",
      "Foreign HTTP, service workers and mutating methods blocked"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["xss"]
  },
  {
    "id": "csrf.form-inventory",
    "version": 2,
    "family": "csrf",
    "title": "State-changing form and simple-request inventory",
    "prerequisites": [],
    "applicability": "FORM",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["csrf"]
  },
  {
    "id": "csrf.cookie-metadata",
    "version": 1,
    "family": "csrf",
    "title": "Session SameSite and CSRF-token metadata review",
    "prerequisites": [],
    "applicability": "COOKIE",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["csrf"]
  },
  {
    "id": "csrf.api-inventory",
    "version": 1,
    "family": "csrf",
    "title": "Observed script API methods and content-type constraints",
    "prerequisites": [],
    "applicability": "JAVASCRIPT",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["csrf"]
  },
  {
    "id": "sqli.error-differential",
    "version": 2,
    "family": "sqli",
    "title": "Repeated SQL-like error differential with inert control",
    "prerequisites": [],
    "applicability": "QUERY_INPUT",
    "risk": "SAFE_ACTIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 8,
    "candidateEvidence": "Observed input, format or reproducible response anomaly; never status alone.",
    "confirmationEvidence": "Repeated error versus inert controls and independently repeated boolean positive/negative controls must both agree before promotion.",
    "negativeControls": [
      "Repeat database-specific signature",
      "Inert control without SQL error",
      "Positive response matches baseline",
      "Repeated negative differs without error; no OR/UNION/data extraction"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["sqli"]
  },
  {
    "id": "sqli.boolean-differential",
    "version": 2,
    "family": "sqli",
    "title": "Matched boolean responses with repeated controls",
    "prerequisites": [],
    "applicability": "QUERY_INPUT",
    "risk": "SAFE_ACTIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 6,
    "candidateEvidence": "Observed input, format or reproducible response anomaly; never status alone.",
    "confirmationEvidence": "Repeated error versus inert controls and independently repeated boolean positive/negative controls must both agree before promotion.",
    "negativeControls": [
      "Repeat database-specific signature",
      "Inert control without SQL error",
      "Positive response matches baseline",
      "Repeated negative differs without error; no OR/UNION/data extraction"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["sqli"]
  },
  {
    "id": "cmdi.input-discovery",
    "version": 1,
    "family": "command-injection",
    "title": "Command-shaped input inventory without executing commands",
    "prerequisites": [],
    "applicability": "QUERY_INPUT",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["command-injection"]
  },
  {
    "id": "cmdi.error-signature",
    "version": 1,
    "family": "command-injection",
    "title": "Existing command/parser errors as weak signals",
    "prerequisites": [],
    "applicability": "ALWAYS",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["command-injection"]
  },
  {
    "id": "ssrf.url-input-discovery",
    "version": 1,
    "family": "ssrf",
    "title": "URL-like query and callback/import input discovery",
    "prerequisites": [],
    "applicability": "URL_INPUT",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["ssrf"]
  },
  {
    "id": "ssrf.controlled-oob",
    "version": 2,
    "family": "ssrf",
    "title": "Token-correlated callback to the configured operator catcher",
    "prerequisites": [
      "OOB_CALLBACK"
    ],
    "applicability": "URL_INPUT",
    "risk": "SAFE_ACTIVE",
    "probeRisk": "LOW_IMPACT",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 6,
    "candidateEvidence": "Observed input, format or reproducible response anomaly; never status alone.",
    "confirmationEvidence": "Two unique configured-catcher tokens correlate; this validates server-side callback behavior, not arbitrary internal access or SSRF impact.",
    "negativeControls": [
      "Only configured operator origin/path",
      "No implicit fallback",
      "No LAN/cloud/alternate protocol probes",
      "No Finding from callback capability alone"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["ssrf"]
  },
  {
    "id": "xxe.xml-inventory",
    "version": 1,
    "family": "xxe",
    "title": "Observed XML support and endpoint inventory",
    "prerequisites": [
      "XML_ENDPOINT"
    ],
    "applicability": "XML",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["xxe"]
  },
  {
    "id": "xxe.document-review",
    "version": 2,
    "family": "xxe",
    "title": "Existing DOCTYPE and parser metadata review",
    "prerequisites": [
      "XML_ENDPOINT"
    ],
    "applicability": "XML",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["xxe"]
  },
  {
    "id": "ssti.arithmetic-differential",
    "version": 2,
    "family": "ssti",
    "title": "Two arithmetic expressions with inert and literal controls",
    "prerequisites": [],
    "applicability": "QUERY_INPUT",
    "risk": "SAFE_ACTIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 8,
    "candidateEvidence": "Observed input, format or reproducible response anomaly; never status alone.",
    "confirmationEvidence": "Two distinct nonce-delimited arithmetic results evaluate correctly and an inert control does not; literal expressions are rejected.",
    "negativeControls": [
      "Fresh marker",
      "Different arithmetic results",
      "Inert control",
      "Reject literal reflection"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["ssti"]
  },
  {
    "id": "ssti.literal-control",
    "version": 1,
    "family": "ssti",
    "title": "Literal-reflection negative control",
    "prerequisites": [],
    "applicability": "QUERY_INPUT",
    "risk": "SAFE_ACTIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 6,
    "candidateEvidence": "Observed input, format or reproducible response anomaly; never status alone.",
    "confirmationEvidence": "Independent positive and negative comparisons or controlled browser/OOB evidence; otherwise remain INFO candidate.",
    "negativeControls": [
      "Baseline and catch-all/error-shell rejection",
      "Repeatability; reflection is not evaluation",
      "No sensitive payload/body/token persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["ssti"]
  },
  {
    "id": "cors.origin-matrix",
    "version": 2,
    "family": "cors",
    "title": "Arbitrary/null/prefix/suffix Origin matrix",
    "prerequisites": [],
    "applicability": "API_ENDPOINT",
    "risk": "SAFE_ACTIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 8,
    "candidateEvidence": "Observed input, format or reproducible response anomaly; never status alone.",
    "confirmationEvidence": "Header reflection is only a candidate. Repeated credentialed content difference can be VALIDATED, but remains below Finding without demonstrated browser readability and cookie feasibility.",
    "negativeControls": [
      "Origin matrix including null/prefix/suffix",
      "Authenticated and anonymous content comparison",
      "Repeated content stability",
      "No header-only impact escalation"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["cors"]
  },
  {
    "id": "cors.sensitive-comparison",
    "version": 1,
    "family": "cors",
    "title": "Credentialed versus anonymous content comparison",
    "prerequisites": [
      "AUTHENTICATED_SESSION"
    ],
    "applicability": "API_ENDPOINT",
    "risk": "SAFE_ACTIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 6,
    "candidateEvidence": "Observed input, format or reproducible response anomaly; never status alone.",
    "confirmationEvidence": "Header reflection is only a candidate. Repeated credentialed content difference can be VALIDATED, but remains below Finding without demonstrated browser readability and cookie feasibility.",
    "negativeControls": [
      "Origin matrix including null/prefix/suffix",
      "Authenticated and anonymous content comparison",
      "Repeated content stability",
      "No header-only impact escalation"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["cors"]
  },
  {
    "id": "jwt.claims-audit",
    "version": 2,
    "family": "jwt",
    "title": "Offline token structure and expiry metadata",
    "prerequisites": [
      "JWT"
    ],
    "applicability": "JWT",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["jwt"]
  },
  {
    "id": "jwt.validation-differential",
    "version": 2,
    "family": "jwt",
    "title": "Changed-signature acceptance versus valid/anonymous controls",
    "prerequisites": [
      "JWT"
    ],
    "applicability": "JWT",
    "risk": "SAFE_ACTIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 6,
    "candidateEvidence": "Observed input, format or reproducible response anomaly; never status alone.",
    "confirmationEvidence": "Two independently corrupted signatures still read the same protected JSON object as the valid token while anonymous controls do not.",
    "negativeControls": [
      "Valid-token baseline",
      "Anonymous control",
      "Two independent invalid signatures",
      "No changed identity claims or secret guessing"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["jwt"]
  },
  {
    "id": "oauth.flow-inventory",
    "version": 1,
    "family": "oauth",
    "title": "Observed OAuth flow, state and PKCE inventory",
    "prerequisites": [
      "OAUTH_FLOW"
    ],
    "applicability": "OAUTH",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["oauth"]
  },
  {
    "id": "oauth.flow-controls",
    "version": 2,
    "family": "oauth",
    "title": "Redirect and response-type configuration observations",
    "prerequisites": [
      "OAUTH_FLOW"
    ],
    "applicability": "OAUTH",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["oauth"]
  },
  {
    "id": "lfi.path-input-discovery",
    "version": 1,
    "family": "lfi",
    "title": "File/path-like input inventory",
    "prerequisites": [],
    "applicability": "FILE_INPUT",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["lfi"]
  },
  {
    "id": "lfi.path-error-differential",
    "version": 2,
    "family": "lfi",
    "title": "Nonexistent harmless path and error controls",
    "prerequisites": [],
    "applicability": "FILE_INPUT",
    "risk": "SAFE_ACTIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 8,
    "candidateEvidence": "Observed input, format or reproducible response anomaly; never status alone.",
    "confirmationEvidence": "A benign missing-filename error remains CANDIDATE/INFO; traversal, local inclusion and remote inclusion are not inferred.",
    "negativeControls": [
      "Original baseline",
      "Nonexistent benign filename",
      "No system-file retrieval"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["lfi"]
  },
  {
    "id": "serialization.cookie-signature",
    "version": 2,
    "family": "deserialization",
    "title": "Cookie format signature without storing values",
    "prerequisites": [],
    "applicability": "COOKIE",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["deserialization"]
  },
  {
    "id": "serialization.input-signature",
    "version": 2,
    "family": "deserialization",
    "title": "Observed query/hidden-input serialization signatures",
    "prerequisites": [],
    "applicability": "ALWAYS",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["deserialization"]
  },
  {
    "id": "business.race-inventory",
    "version": 2,
    "family": "business-logic-race",
    "title": "Limited-use action inventory without replay",
    "prerequisites": [],
    "applicability": "BUSINESS_FLOW",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["business-logic-race"]
  },
  {
    "id": "business.replay-review",
    "version": 1,
    "family": "business-logic-race",
    "title": "Observed retry/idempotency context review",
    "prerequisites": [],
    "applicability": "BUSINESS_FLOW",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["business-logic-race"]
  },
  {
    "id": "business.critical-field-inventory",
    "version": 2,
    "family": "business-logic-tamper",
    "title": "Quantity/price/role/plan field inventory",
    "prerequisites": [],
    "applicability": "BUSINESS_FLOW",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["business-logic-tamper"]
  },
  {
    "id": "business.value-review",
    "version": 2,
    "family": "business-logic-tamper",
    "title": "Observed server/client value-trust assumptions",
    "prerequisites": [],
    "applicability": "BUSINESS_FLOW",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["business-logic-tamper"]
  },
  {
    "id": "business.workflow-inventory",
    "version": 1,
    "family": "business-logic-workflow",
    "title": "Observed multi-step route sequences",
    "prerequisites": [],
    "applicability": "BUSINESS_FLOW",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["business-logic-workflow"]
  },
  {
    "id": "business.transition-review",
    "version": 1,
    "family": "business-logic-workflow",
    "title": "Review transition ordering without calling final actions",
    "prerequisites": [],
    "applicability": "BUSINESS_FLOW",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["business-logic-workflow"]
  },
  {
    "id": "disclosure.git-head",
    "version": 1,
    "family": "information-disclosure",
    "title": "Minimal Git HEAD exposure with catch-all controls",
    "prerequisites": [],
    "applicability": "ALWAYS",
    "risk": "SAFE_ACTIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 6,
    "candidateEvidence": "Observed input, format or reproducible response anomaly; never status alone.",
    "confirmationEvidence": "A minimal Git HEAD ref marker repeats and differs from the nonexistent-path catch-all.",
    "negativeControls": [
      "Strict ref syntax",
      "Independent repeat",
      "Catch-all comparison",
      "No config/source/credential retrieval"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["information-disclosure"]
  },
  {
    "id": "disclosure.header-inventory",
    "version": 1,
    "family": "information-disclosure",
    "title": "Observed diagnostic/security-header metadata",
    "prerequisites": [],
    "applicability": "ALWAYS",
    "risk": "PASSIVE",
    "probeRisk": "SAFE",
    "requiresApproval": false,
    "implementation": "IMPLEMENTED",
    "maxRequests": 0,
    "candidateEvidence": "An observed structure/format/input, without executing a state-changing action.",
    "confirmationEvidence": "Passive observation is not independently confirmable: retain SIGNAL/INFO, never promote from a signature alone.",
    "negativeControls": [
      "A route, field, sink or format signature alone is insufficient",
      "No inferred ownership or security impact",
      "No credentials, token prefix or response body persisted"
    ],
    "evidenceRequired": [
      "Scoped reproducible observation",
      "Independent confirmation for any promotion"
    ],
    "references": HUNT_REFERENCES["information-disclosure"]
  },
  {
    "id": "xss.stored-write",
    "version": 1,
    "family": "xss",
    "title": "Stored XSS write/cleanup",
    "prerequisites": [],
    "applicability": "ALWAYS",
    "risk": "STATE_CHANGING",
    "probeRisk": "REQUIRES_APPROVAL",
    "requiresApproval": true,
    "implementation": "UNSUPPORTED",
    "maxRequests": 0,
    "candidateEvidence": "Manual review only.",
    "confirmationEvidence": "Not executable: confinement or reversibility is not guaranteed.",
    "negativeControls": [
      "No automated request permitted"
    ],
    "evidenceRequired": [
      "Separate explicit human testing plan"
    ],
    "references": HUNT_REFERENCES["xss"]
  },
  {
    "id": "csrf.submit-action",
    "version": 1,
    "family": "csrf",
    "title": "Trigger a real state-changing CSRF action",
    "prerequisites": [],
    "applicability": "ALWAYS",
    "risk": "STATE_CHANGING",
    "probeRisk": "REQUIRES_APPROVAL",
    "requiresApproval": true,
    "implementation": "UNSUPPORTED",
    "maxRequests": 0,
    "candidateEvidence": "Manual review only.",
    "confirmationEvidence": "Not executable: confinement or reversibility is not guaranteed.",
    "negativeControls": [
      "No automated request permitted"
    ],
    "evidenceRequired": [
      "Separate explicit human testing plan"
    ],
    "references": HUNT_REFERENCES["csrf"]
  },
  {
    "id": "ssrf.internal-probing",
    "version": 1,
    "family": "ssrf",
    "title": "Metadata, LAN or arbitrary protocol probing",
    "prerequisites": [],
    "applicability": "ALWAYS",
    "risk": "HIGH_RISK",
    "probeRisk": "FORBIDDEN_AUTOMATIC",
    "requiresApproval": true,
    "implementation": "UNSUPPORTED",
    "maxRequests": 0,
    "candidateEvidence": "Manual review only.",
    "confirmationEvidence": "Not executable: confinement or reversibility is not guaranteed.",
    "negativeControls": [
      "No automated request permitted"
    ],
    "evidenceRequired": [
      "Separate explicit human testing plan"
    ],
    "references": HUNT_REFERENCES["ssrf"]
  },
  {
    "id": "xxe.controlled-oob",
    "version": 1,
    "family": "xxe",
    "title": "POST external entity to configured catcher",
    "prerequisites": [],
    "applicability": "ALWAYS",
    "risk": "STATE_CHANGING",
    "probeRisk": "REQUIRES_APPROVAL",
    "requiresApproval": true,
    "implementation": "UNSUPPORTED",
    "maxRequests": 0,
    "candidateEvidence": "Manual review only.",
    "confirmationEvidence": "Not executable: confinement or reversibility is not guaranteed.",
    "negativeControls": [
      "No automated request permitted"
    ],
    "evidenceRequired": [
      "Separate explicit human testing plan"
    ],
    "references": HUNT_REFERENCES["xxe"]
  },
  {
    "id": "xxe.file-read",
    "version": 1,
    "family": "xxe",
    "title": "External entity local-file retrieval",
    "prerequisites": [],
    "applicability": "ALWAYS",
    "risk": "HIGH_RISK",
    "probeRisk": "FORBIDDEN_AUTOMATIC",
    "requiresApproval": true,
    "implementation": "UNSUPPORTED",
    "maxRequests": 0,
    "candidateEvidence": "Manual review only.",
    "confirmationEvidence": "Not executable: confinement or reversibility is not guaranteed.",
    "negativeControls": [
      "No automated request permitted"
    ],
    "evidenceRequired": [
      "Separate explicit human testing plan"
    ],
    "references": HUNT_REFERENCES["xxe"]
  },
  {
    "id": "lfi.file-read",
    "version": 1,
    "family": "lfi",
    "title": "System-file inclusion or remote code inclusion",
    "prerequisites": [],
    "applicability": "ALWAYS",
    "risk": "HIGH_RISK",
    "probeRisk": "FORBIDDEN_AUTOMATIC",
    "requiresApproval": true,
    "implementation": "UNSUPPORTED",
    "maxRequests": 0,
    "candidateEvidence": "Manual review only.",
    "confirmationEvidence": "Not executable: confinement or reversibility is not guaranteed.",
    "negativeControls": [
      "No automated request permitted"
    ],
    "evidenceRequired": [
      "Separate explicit human testing plan"
    ],
    "references": HUNT_REFERENCES["lfi"]
  },
  {
    "id": "jwt.secret-recovery",
    "version": 1,
    "family": "jwt",
    "title": "Signing-secret guessing or recovery",
    "prerequisites": [],
    "applicability": "ALWAYS",
    "risk": "HIGH_RISK",
    "probeRisk": "FORBIDDEN_AUTOMATIC",
    "requiresApproval": true,
    "implementation": "UNSUPPORTED",
    "maxRequests": 0,
    "candidateEvidence": "Manual review only.",
    "confirmationEvidence": "Not executable: confinement or reversibility is not guaranteed.",
    "negativeControls": [
      "No automated request permitted"
    ],
    "evidenceRequired": [
      "Separate explicit human testing plan"
    ],
    "references": HUNT_REFERENCES["jwt"]
  },
  {
    "id": "serialization.gadget-chain",
    "version": 1,
    "family": "deserialization",
    "title": "Execute a deserialization gadget chain",
    "prerequisites": [],
    "applicability": "ALWAYS",
    "risk": "HIGH_RISK",
    "probeRisk": "FORBIDDEN_AUTOMATIC",
    "requiresApproval": true,
    "implementation": "UNSUPPORTED",
    "maxRequests": 0,
    "candidateEvidence": "Manual review only.",
    "confirmationEvidence": "Not executable: confinement or reversibility is not guaranteed.",
    "negativeControls": [
      "No automated request permitted"
    ],
    "evidenceRequired": [
      "Separate explicit human testing plan"
    ],
    "references": HUNT_REFERENCES["deserialization"]
  },
  {
    "id": "business.race-replay",
    "version": 1,
    "family": "business-logic-race",
    "title": "Concurrent business action replay",
    "prerequisites": [],
    "applicability": "ALWAYS",
    "risk": "STATE_CHANGING",
    "probeRisk": "REQUIRES_APPROVAL",
    "requiresApproval": true,
    "implementation": "UNSUPPORTED",
    "maxRequests": 0,
    "candidateEvidence": "Manual review only.",
    "confirmationEvidence": "Not executable: confinement or reversibility is not guaranteed.",
    "negativeControls": [
      "No automated request permitted"
    ],
    "evidenceRequired": [
      "Separate explicit human testing plan"
    ],
    "references": HUNT_REFERENCES["business-logic-race"]
  },
  {
    "id": "business.value-mutation",
    "version": 1,
    "family": "business-logic-tamper",
    "title": "Mutate financial or authorization fields",
    "prerequisites": [],
    "applicability": "ALWAYS",
    "risk": "STATE_CHANGING",
    "probeRisk": "REQUIRES_APPROVAL",
    "requiresApproval": true,
    "implementation": "UNSUPPORTED",
    "maxRequests": 0,
    "candidateEvidence": "Manual review only.",
    "confirmationEvidence": "Not executable: confinement or reversibility is not guaranteed.",
    "negativeControls": [
      "No automated request permitted"
    ],
    "evidenceRequired": [
      "Separate explicit human testing plan"
    ],
    "references": HUNT_REFERENCES["business-logic-tamper"]
  },
  {
    "id": "business.skip-final",
    "version": 1,
    "family": "business-logic-workflow",
    "title": "Call a final workflow action out of order",
    "prerequisites": [],
    "applicability": "ALWAYS",
    "risk": "STATE_CHANGING",
    "probeRisk": "REQUIRES_APPROVAL",
    "requiresApproval": true,
    "implementation": "UNSUPPORTED",
    "maxRequests": 0,
    "candidateEvidence": "Manual review only.",
    "confirmationEvidence": "Not executable: confinement or reversibility is not guaranteed.",
    "negativeControls": [
      "No automated request permitted"
    ],
    "evidenceRequired": [
      "Separate explicit human testing plan"
    ],
    "references": HUNT_REFERENCES["business-logic-workflow"]
  },
  {
    "id": "sqli.timing-screen",
    "version": 1,
    "family": "sqli",
    "title": "Explicitly approved bounded timing screen",
    "prerequisites": [],
    "applicability": "QUERY_INPUT",
    "risk": "HIGH_RISK",
    "probeRisk": "REQUIRES_APPROVAL",
    "requiresApproval": true,
    "implementation": "IMPLEMENTED",
    "maxRequests": 6,
    "candidateEvidence": "Three interleaved matched zero/one-second pairs.",
    "confirmationEvidence": "Independent zero/two-second pairs, stable response content, low variance, and delays tracking expected values.",
    "negativeControls": [
      "Interleaved zero-delay controls",
      "Repeated samples and jitter distribution",
      "Independent larger delay",
      "Explicit per-run approval"
    ],
    "evidenceRequired": [
      "Matched content",
      "Six independent positive/control pairs"
    ],
    "references": HUNT_REFERENCES["sqli"]
  },
  {
    "id": "sqli.timing-confirm",
    "version": 1,
    "family": "sqli",
    "title": "Explicitly approved bounded timing confirm",
    "prerequisites": [],
    "applicability": "QUERY_INPUT",
    "risk": "HIGH_RISK",
    "probeRisk": "REQUIRES_APPROVAL",
    "requiresApproval": true,
    "implementation": "IMPLEMENTED",
    "maxRequests": 6,
    "candidateEvidence": "Three interleaved matched zero/one-second pairs.",
    "confirmationEvidence": "Independent zero/two-second pairs, stable response content, low variance, and delays tracking expected values.",
    "negativeControls": [
      "Interleaved zero-delay controls",
      "Repeated samples and jitter distribution",
      "Independent larger delay",
      "Explicit per-run approval"
    ],
    "evidenceRequired": [
      "Matched content",
      "Six independent positive/control pairs"
    ],
    "references": HUNT_REFERENCES["sqli"]
  },
  {
    "id": "cmdi.timing-screen",
    "version": 1,
    "family": "command-injection",
    "title": "Explicitly approved bounded timing screen",
    "prerequisites": [],
    "applicability": "QUERY_INPUT",
    "risk": "HIGH_RISK",
    "probeRisk": "REQUIRES_APPROVAL",
    "requiresApproval": true,
    "implementation": "IMPLEMENTED",
    "maxRequests": 6,
    "candidateEvidence": "Three interleaved matched zero/one-second pairs.",
    "confirmationEvidence": "Independent zero/two-second pairs, stable response content, low variance, and delays tracking expected values.",
    "negativeControls": [
      "Interleaved zero-delay controls",
      "Repeated samples and jitter distribution",
      "Independent larger delay",
      "Explicit per-run approval"
    ],
    "evidenceRequired": [
      "Matched content",
      "Six independent positive/control pairs"
    ],
    "references": HUNT_REFERENCES["command-injection"]
  },
  {
    "id": "cmdi.timing-confirm",
    "version": 1,
    "family": "command-injection",
    "title": "Explicitly approved bounded timing confirm",
    "prerequisites": [],
    "applicability": "QUERY_INPUT",
    "risk": "HIGH_RISK",
    "probeRisk": "REQUIRES_APPROVAL",
    "requiresApproval": true,
    "implementation": "IMPLEMENTED",
    "maxRequests": 6,
    "candidateEvidence": "Three interleaved matched zero/one-second pairs.",
    "confirmationEvidence": "Independent zero/two-second pairs, stable response content, low variance, and delays tracking expected values.",
    "negativeControls": [
      "Interleaved zero-delay controls",
      "Repeated samples and jitter distribution",
      "Independent larger delay",
      "Explicit per-run approval"
    ],
    "evidenceRequired": [
      "Matched content",
      "Six independent positive/control pairs"
    ],
    "references": HUNT_REFERENCES["command-injection"]
  },
  ...(["algorithm-differential", "key-selection-review"] as const).map(kind => ({
    id: `jwt.${kind}`, version: 1, family: "jwt" as const,
    title: kind === "algorithm-differential" ? "Unsigned JWT algorithm controls" : "Benign missing JWT key selection review",
    prerequisites: ["JWT"] as ["JWT"], applicability: "JWT" as const,
    risk: "SAFE_ACTIVE" as const, probeRisk: "SAFE" as const, requiresApproval: false, implementation: "IMPLEMENTED" as const, maxRequests: 6,
    candidateEvidence: "Changed token behavior with isolated authenticated JSON object and anonymous control.",
    confirmationEvidence: "Two invalid tokens and independent repeat must match the valid object; missing kid alone remains a candidate.",
    negativeControls: ["No ambient second credential", "Anonymous denial/content difference", "Unchanged identity claims", "No remote keys, file paths, secret recovery"],
    evidenceRequired: ["Authenticated JSON object", "Independent invalid-token controls"], references: HUNT_REFERENCES.jwt,
  })),
];
