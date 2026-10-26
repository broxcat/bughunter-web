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
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "id": "auth.read-differential",
    "version": 1,
    "family": "auth-bypass",
    "title": "Authenticated versus anonymous content differential",
    "prerequisites": [],
    "applicability": "API_ENDPOINT",
    "risk": "SAFE_ACTIVE",
    "requiresApproval": false,
    "implementation": "PLANNED",
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
    "version": 1,
    "family": "auth-bypass",
    "title": "Read-only routing header with independent content control",
    "prerequisites": [],
    "applicability": "API_ENDPOINT",
    "risk": "SAFE_ACTIVE",
    "requiresApproval": false,
    "implementation": "PLANNED",
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
    "version": 1,
    "family": "idor",
    "title": "Numeric and opaque references in observed URLs",
    "prerequisites": [],
    "applicability": "OBJECT_REFERENCE",
    "risk": "PASSIVE",
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "references": HUNT_REFERENCES["idor"]
  },
  {
    "id": "idor.query-reference",
    "version": 1,
    "family": "idor",
    "title": "Query and nested reference inventory",
    "prerequisites": [],
    "applicability": "OBJECT_REFERENCE",
    "risk": "PASSIVE",
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "references": HUNT_REFERENCES["idor"]
  },
  {
    "id": "bola.account-differential",
    "version": 1,
    "family": "bola",
    "title": "Two-account comparison on an explicitly owned object",
    "prerequisites": [
      "PRIMARY_CREDENTIAL",
      "SECOND_CREDENTIAL",
      "SECOND_USER_OBJECT_REFERENCE"
    ],
    "applicability": "OBJECT_REFERENCE",
    "risk": "SAFE_ACTIVE",
    "requiresApproval": false,
    "implementation": "PLANNED",
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
    "references": HUNT_REFERENCES["bola"]
  },
  {
    "id": "bola.anonymous-control",
    "version": 1,
    "family": "bola",
    "title": "Anonymous and repeated-account negative controls",
    "prerequisites": [
      "PRIMARY_CREDENTIAL",
      "SECOND_CREDENTIAL",
      "SECOND_USER_OBJECT_REFERENCE"
    ],
    "applicability": "OBJECT_REFERENCE",
    "risk": "SAFE_ACTIVE",
    "requiresApproval": false,
    "implementation": "PLANNED",
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
    "references": HUNT_REFERENCES["bola"]
  },
  {
    "id": "xss.reflection",
    "version": 1,
    "family": "xss",
    "title": "Unique reflected canary and output context",
    "prerequisites": [],
    "applicability": "QUERY_INPUT",
    "risk": "SAFE_ACTIVE",
    "requiresApproval": false,
    "implementation": "PLANNED",
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
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "references": HUNT_REFERENCES["xss"]
  },
  {
    "id": "xss.browser-confirmation",
    "version": 1,
    "family": "xss",
    "title": "Independent harmless canary execution in a confined browser",
    "prerequisites": [
      "BROWSER_CONTEXT"
    ],
    "applicability": "QUERY_INPUT",
    "risk": "SAFE_ACTIVE",
    "requiresApproval": false,
    "implementation": "PLANNED",
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
    "references": HUNT_REFERENCES["xss"]
  },
  {
    "id": "csrf.form-inventory",
    "version": 1,
    "family": "csrf",
    "title": "State-changing form and simple-request inventory",
    "prerequisites": [],
    "applicability": "FORM",
    "risk": "PASSIVE",
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "references": HUNT_REFERENCES["csrf"]
  },
  {
    "id": "sqli.error-differential",
    "version": 1,
    "family": "sqli",
    "title": "Repeated SQL-like error differential with inert control",
    "prerequisites": [],
    "applicability": "QUERY_INPUT",
    "risk": "SAFE_ACTIVE",
    "requiresApproval": false,
    "implementation": "PLANNED",
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
    "references": HUNT_REFERENCES["sqli"]
  },
  {
    "id": "sqli.boolean-differential",
    "version": 1,
    "family": "sqli",
    "title": "Matched boolean responses with repeated controls",
    "prerequisites": [],
    "applicability": "QUERY_INPUT",
    "risk": "SAFE_ACTIVE",
    "requiresApproval": false,
    "implementation": "PLANNED",
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
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "references": HUNT_REFERENCES["ssrf"]
  },
  {
    "id": "ssrf.controlled-oob",
    "version": 1,
    "family": "ssrf",
    "title": "Token-correlated callback to the configured operator catcher",
    "prerequisites": [
      "OOB_CALLBACK"
    ],
    "applicability": "URL_INPUT",
    "risk": "SAFE_ACTIVE",
    "requiresApproval": false,
    "implementation": "PLANNED",
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
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "references": HUNT_REFERENCES["xxe"]
  },
  {
    "id": "xxe.document-review",
    "version": 1,
    "family": "xxe",
    "title": "Existing DOCTYPE and parser metadata review",
    "prerequisites": [
      "XML_ENDPOINT"
    ],
    "applicability": "XML",
    "risk": "PASSIVE",
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "references": HUNT_REFERENCES["xxe"]
  },
  {
    "id": "ssti.arithmetic-differential",
    "version": 1,
    "family": "ssti",
    "title": "Two arithmetic expressions with inert and literal controls",
    "prerequisites": [],
    "applicability": "QUERY_INPUT",
    "risk": "SAFE_ACTIVE",
    "requiresApproval": false,
    "implementation": "PLANNED",
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
    "id": "ssti.literal-control",
    "version": 1,
    "family": "ssti",
    "title": "Literal-reflection negative control",
    "prerequisites": [],
    "applicability": "QUERY_INPUT",
    "risk": "SAFE_ACTIVE",
    "requiresApproval": false,
    "implementation": "PLANNED",
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
    "version": 1,
    "family": "cors",
    "title": "Arbitrary/null/prefix/suffix Origin matrix",
    "prerequisites": [],
    "applicability": "API_ENDPOINT",
    "risk": "SAFE_ACTIVE",
    "requiresApproval": false,
    "implementation": "PLANNED",
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
    "requiresApproval": false,
    "implementation": "PLANNED",
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
    "references": HUNT_REFERENCES["cors"]
  },
  {
    "id": "jwt.claims-audit",
    "version": 1,
    "family": "jwt",
    "title": "Offline token structure and expiry metadata",
    "prerequisites": [
      "JWT"
    ],
    "applicability": "JWT",
    "risk": "PASSIVE",
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "references": HUNT_REFERENCES["jwt"]
  },
  {
    "id": "jwt.validation-differential",
    "version": 1,
    "family": "jwt",
    "title": "Changed-signature acceptance versus valid/anonymous controls",
    "prerequisites": [
      "JWT"
    ],
    "applicability": "JWT",
    "risk": "SAFE_ACTIVE",
    "requiresApproval": false,
    "implementation": "PLANNED",
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
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "references": HUNT_REFERENCES["oauth"]
  },
  {
    "id": "oauth.flow-controls",
    "version": 1,
    "family": "oauth",
    "title": "Redirect and response-type configuration observations",
    "prerequisites": [
      "OAUTH_FLOW"
    ],
    "applicability": "OAUTH",
    "risk": "PASSIVE",
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "references": HUNT_REFERENCES["lfi"]
  },
  {
    "id": "lfi.path-error-differential",
    "version": 1,
    "family": "lfi",
    "title": "Nonexistent harmless path and error controls",
    "prerequisites": [],
    "applicability": "FILE_INPUT",
    "risk": "SAFE_ACTIVE",
    "requiresApproval": false,
    "implementation": "PLANNED",
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
    "references": HUNT_REFERENCES["lfi"]
  },
  {
    "id": "serialization.cookie-signature",
    "version": 1,
    "family": "deserialization",
    "title": "Cookie format signature without storing values",
    "prerequisites": [],
    "applicability": "COOKIE",
    "risk": "PASSIVE",
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "references": HUNT_REFERENCES["deserialization"]
  },
  {
    "id": "serialization.input-signature",
    "version": 1,
    "family": "deserialization",
    "title": "Observed query/hidden-input serialization signatures",
    "prerequisites": [],
    "applicability": "ALWAYS",
    "risk": "PASSIVE",
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "references": HUNT_REFERENCES["deserialization"]
  },
  {
    "id": "business.race-inventory",
    "version": 1,
    "family": "business-logic-race",
    "title": "Limited-use action inventory without replay",
    "prerequisites": [],
    "applicability": "BUSINESS_FLOW",
    "risk": "PASSIVE",
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "references": HUNT_REFERENCES["business-logic-race"]
  },
  {
    "id": "business.critical-field-inventory",
    "version": 1,
    "family": "business-logic-tamper",
    "title": "Quantity/price/role/plan field inventory",
    "prerequisites": [],
    "applicability": "BUSINESS_FLOW",
    "risk": "PASSIVE",
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "references": HUNT_REFERENCES["business-logic-tamper"]
  },
  {
    "id": "business.value-review",
    "version": 1,
    "family": "business-logic-tamper",
    "title": "Observed server/client value-trust assumptions",
    "prerequisites": [],
    "applicability": "BUSINESS_FLOW",
    "risk": "PASSIVE",
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "requiresApproval": false,
    "implementation": "PLANNED",
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
    "requiresApproval": false,
    "implementation": "PLANNED",
    "maxRequests": 0,
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
    "id": "sqli.paired-timing",
    "version": 1,
    "family": "sqli",
    "title": "Induced delays and timing distribution confirmation",
    "prerequisites": [],
    "applicability": "ALWAYS",
    "risk": "HIGH_RISK",
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
    "references": HUNT_REFERENCES["sqli"]
  },
  {
    "id": "cmdi.paired-timing",
    "version": 1,
    "family": "command-injection",
    "title": "Induced command timing/marker execution",
    "prerequisites": [],
    "applicability": "ALWAYS",
    "risk": "HIGH_RISK",
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
    "references": HUNT_REFERENCES["command-injection"]
  },
  {
    "id": "ssrf.internal-probing",
    "version": 1,
    "family": "ssrf",
    "title": "Metadata, LAN or arbitrary protocol probing",
    "prerequisites": [],
    "applicability": "ALWAYS",
    "risk": "HIGH_RISK",
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
  }
];
