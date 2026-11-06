# Minimal Evidence Vault

Evidence records have durable `EV-…` identities. The same record can support or refute a Hypothesis, belong to a structured Coverage test, accompany a Finding and be retained by a Report. These are provenance relationships, not automatic vulnerability confirmation.

Open **Evidence** in a Hypothesis, Coverage test, Finding or saved Report. Register an existing Recon artifact, Research/Burp workspace reference, or a minimal explicit HTTP capture. Reuse an existing Evidence ID to link it without copying content. Supports/Refutes/Context roles and hypothesis revisions remain visible. Human promotion copies only links for the reviewed current Hypothesis revision to the CANDIDATE Finding. Independent Evidence Review remains mandatory for Report eligibility. Reports preserve the same IDs, hashes and roles; their database relationships retain the same evidence identities.

## Supported sources

- **RECON_ARTIFACT**: reference a real artifact for this technical Target. No Recon body, raw tool output or artifact value is copied. Source ID, scan, asset, observed scope/verification and timestamps are retained. Discovery never grants authorization.
- **RESEARCH_EVIDENCE**: reference a safe relative file in an owned READY session. The file is opened without symlinks/hardlinks and hashed with a bounded read. No file content is copied to SQL or returned to the browser.
- **BURP_REFERENCE**: the same guarded reference policy, restricted to existing requests/burp or evidence/burp artifacts. This is a workspace reference, not a claim of an independently verified Burp execution.
- **HTTP_REQUEST_RESPONSE**: explicitly supplied method, in-scope observed URL, response status/content type and optional short relevant excerpts. Raw headers and unexpected credential fields are rejected. No request is executed by registration.

Metadata/excerpts are cleaned before persistence and again at read time. Credential-shaped fields, nested token/password/cookie/Authorization keys, common personal email addresses and private-key blocks are redacted; URLs have credentials/query values and private identity segments removed. Keep unrelated personal data and unlabelled secrets out of descriptions and excerpts. HTTP excerpts are explicit, limited captures; no full Proxy History, terminal transcript or arbitrary file upload is ingested.

## Persistence and integrity

Records are immutable through the service and deduplicated by Target and source identity: Recon ID, workspace session/path/SHA-256, or explicit HTTP capture identity and cleaned metadata hash. A changed source file produces a new identity. Existing IDs do not silently acquire new content or descriptions. A workspace hash proves what was registered; it does not promise that a deliberately edited/deleted workspace file remains downloadable. Reference-only records are labelled `REFERENCE_ONLY_CONTENT_NOT_COPIED`, not falsely certified redacted raw content.

Live source/entity FKs can become NULL after deliberate deletion while immutable original reference IDs and registration provenance remain. Session closure never erases evidence. Explicit Target deletion removes its Vault records. Existing legacy proof fields are retained; migration `20261106130000_evidence_vault` does not parse or backfill raw historical content.

Structured Coverage test evidence references are registered automatically as reference-only records after their normal ownership/path checks. This consumes explicit structured test events, never terminal text. Legacy Coverage event retries retain their original idempotency hash; new empty evidenceIds fields do not invalidate them. Existing Evidence IDs can be supplied for a test without duplicating source content.

Ownership is enforced before every listing, lookup or link, including entity/Target relationships. New runtime captures require current session/network authorization; attaching existing documentary records does not grant permission to execute tests. Origin checks and bounded metadata bodies apply to mutations. Files are limited to 512 KiB per reference, HTTP snippets to 2,000 characters each, and a Target to 5,000 evidence records. Bounded lists expose truncation; any retained record is retrievable by its durable ID through the owned `/api/evidence/:targetId/:evidenceId` endpoint. No raw file-download endpoint is provided by the Vault.
