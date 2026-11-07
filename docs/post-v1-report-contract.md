# Milestone 4 — pre-change run report contract (5f0f2d8)

This inventory is before implementation. The existing professional report is 25bc86d, corrected by 1a951bc. The separate v3 synthesis already has Settings routing, immutable provider capture, bounded evidence, strict application validation, two-attempt recovery and the OpenRouter/Gemini maxItems transport workaround. Do not replace them.

| Area | Classification | Persisted/current report boundary |
| --- | --- | --- |
| Program identity | COMPLETE | Business name/platform, never technical authorization |
| Authorized Scope | COMPLETE | Captured ScanRun boundary/snapshot only, never discoveries |
| Exclusions/User-Agent/mode | PARTIAL | Captured fields only; missing exclusions vs captured empty were not distinguished; current policy is not borrowed |
| Dates/duration | COMPLETE | Persisted lifecycle timestamps, unavailable duration stays unknown |
| Execution phases/attempts | COMPLETE | Actual provider attempts vs planned stages; missing invocation remains unrecorded |
| DNS/hosts | PARTIAL | Pipeline stores dns-address observations and CNAME/origin relations; report reduces these to hostname labels and loses sources |
| DNS record type / negative answer | NOT_RECORDED_BY_BACKEND | Native addresses lack explicit A/AAAA record-type fields; missing addresses are not NXDOMAIN |
| HTTP/ports/services | PARTIAL | Existing observations; HTTP response vs discovery distinction retained, port state/provenance need presentation |
| Redirects | MISSING | Persisted endpoint redirect/location not projected into run report |
| TLS | MISSING | Existing native TLS persists fingerprint/validFrom/validTo; httpx persists notBefore/notAfter. Report currently drops them |
| TLS issuer/subject/SAN/protocol/cipher/validation | NOT_RECORDED_BY_BACKEND | Current collectors do not persist these systematically; display only if an actual retained historical artifact carries the field; no collector added |
| Static assets | MISSING | Existing URL/endpoint artifacts, report lists them as endpoints; bounded category/count/examples needed |
| Technologies | COMPLETE | Names/versions only if actually captured; no version inference |
| Authenticated Recon | COMPLETE | Persisted safe context/surface export, never credentials |
| Errors/limitations | COMPLETE | Failure/partial/skip distinctions, bounded evidence omission is explicit |
| History/diffs | COMPLETE | Stored changeSet; Not observed is not Removed |
| Provenance | PARTIAL | Artifact store has IDs, scan IDs, sources, first/last times and verification; loader discards them. No invented Vault reference |
| Research handoff | COMPLETE | Deterministic caveats/priorities, no automatic Findings/authorization |
| Markdown | PARTIAL | Safe deterministic export already works; new factual categories and references must match UI |
| AI narrative | PARTIAL | Existing v3 jobs/validators/routing work separately. Run report currently never reads them |

Generation policy: reuse existing stable-run ReconSummary scheduling/cache and Settings capture. Run report read/export/live polling only read existing run-bound synthesis, revalidate against captured run evidence, and remain fully deterministic on any failure. They must not enqueue, inspect a provider or perform inference. Existing provider transport and real acceptance remain valid and unchanged. No paid inference is needed for this integration.
