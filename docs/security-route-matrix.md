# API handler boundary matrix

63 route files: 62 wrapped modules, 90 wrapped HTTP exports; Auth.js has its own two protocol handlers. Generated from actual exports. Shared schemas run inside each export before auth/business, independently of the proxy.

Opaque IDs: ASCII letters, digits, underscore or hyphen, 1..128 characters. Query IDs, page/pageSize/revisionPage and duplicate query keys are checked centrally. Body IDs for scan creation, targets, findings, credential mutation and legacy host assignment reuse routeIdSchema. Domain, enum, payload and ownership schemas remain in their operation handlers/helpers. Unknown query keys retain the existing route-specific behavior.

| Route | Methods | Boundary |
|---|---|---|
| `/api/ai-providers/default` | POST | Shared Zod: no path IDs + query; local body/operation schemas |
| `/api/ai-providers` | GET, POST | Shared Zod: no path IDs + query; local body/operation schemas |
| `/api/auth/[...nextauth]` | GET, POST | Auth.js protocol validation (excluded from opaque-ID wrapper) |
| `/api/evidence/[targetId]` | GET, POST | Shared Zod: targetId + query; local body/operation schemas |
| `/api/evidence/[targetId]/[evidenceId]/links` | POST | Shared Zod: targetId, evidenceId + query; local body/operation schemas |
| `/api/evidence/[targetId]/[evidenceId]` | GET | Shared Zod: targetId, evidenceId + query; local body/operation schemas |
| `/api/findings` | GET, POST | Shared Zod: no path IDs + query; local body/operation schemas |
| `/api/findings/[id]/lifecycle` | GET, POST | Shared Zod: id + query; local body/operation schemas |
| `/api/findings/[id]/retest` | POST | Shared Zod: id + query; local body/operation schemas |
| `/api/findings/[id]` | PATCH | Shared Zod: id + query; local body/operation schemas |
| `/api/findings/[id]/validate` | POST | Shared Zod: id + query; local body/operation schemas |
| `/api/health` | GET | Shared Zod: no path IDs + query; local body/operation schemas |
| `/api/programs/campaign-stream` | GET | Shared Zod: no path IDs + query; local body/operation schemas |
| `/api/programs/import-preview` | POST | Shared Zod: no path IDs + query; local body/operation schemas |
| `/api/programs` | GET, POST | Shared Zod: no path IDs + query; local body/operation schemas |
| `/api/programs/[id]/assessment` | PATCH | Shared Zod: id + query; local body/operation schemas |
| `/api/programs/[id]/assessment-sources` | GET, POST | Shared Zod: id + query; local body/operation schemas |
| `/api/programs/[id]/assessment-sources/[sourceId]` | PATCH, DELETE | Shared Zod: id, sourceId + query; local body/operation schemas |
| `/api/programs/[id]/assets` | GET, POST | Shared Zod: id + query; local body/operation schemas |
| `/api/programs/[id]/assets/[assetId]/recon` | GET, POST | Shared Zod: id, assetId + query; local body/operation schemas |
| `/api/programs/[id]/assets/[assetId]/research` | POST | Shared Zod: id, assetId + query; local body/operation schemas |
| `/api/programs/[id]/assets/[assetId]` | PATCH, DELETE, POST | Shared Zod: id, assetId + query; local body/operation schemas |
| `/api/programs/[id]/assets/[assetId]/scope.md` | GET | Shared Zod: id, assetId + query; local body/operation schemas |
| `/api/programs/[id]/assets/[assetId]/summary` | GET, POST | Shared Zod: id, assetId + query; local body/operation schemas |
| `/api/programs/[id]/campaign/handoff` | GET | Shared Zod: id + query; local body/operation schemas |
| `/api/programs/[id]/campaign` | POST | Shared Zod: id + query; local body/operation schemas |
| `/api/programs/[id]/context` | POST | Shared Zod: id + query; local body/operation schemas |
| `/api/programs/[id]/hosts` | GET, POST | Shared Zod: id + query; local body/operation schemas |
| `/api/programs/[id]/hosts/[hostId]` | PATCH, DELETE | Shared Zod: id, hostId + query; local body/operation schemas |
| `/api/programs/[id]/recon` | GET, POST, DELETE | Shared Zod: id + query; local body/operation schemas |
| `/api/programs/[id]` | GET, PATCH, DELETE | Shared Zod: id + query; local body/operation schemas |
| `/api/programs/[id]/scope.md` | GET | Shared Zod: id + query; local body/operation schemas |
| `/api/programs/[id]/summary` | GET, POST | Shared Zod: id + query; local body/operation schemas |
| `/api/recon/runs/[id]/report/pdf` | GET | Shared Zod: id + query; local body/operation schemas |
| `/api/recon/runs/[id]/report` | GET | Shared Zod: id + query; local body/operation schemas |
| `/api/register` | POST | Shared Zod: no path IDs + query; local body/operation schemas |
| `/api/reports` | GET, POST | Shared Zod: no path IDs + query; local body/operation schemas |
| `/api/research-routing` | GET, POST | Shared Zod: no path IDs + query; local body/operation schemas |
| `/api/research-sessions` | GET | Shared Zod: no path IDs + query; local body/operation schemas |
| `/api/research-sessions/[id]/hypotheses` | GET | Shared Zod: id + query; local body/operation schemas |
| `/api/research-sessions/[id]/hypotheses/[hypothesisId]/finding-draft` | POST | Shared Zod: id, hypothesisId + query; local body/operation schemas |
| `/api/research-sessions/[id]/hypotheses/[hypothesisId]/review` | POST | Shared Zod: id, hypothesisId + query; local body/operation schemas |
| `/api/research-sessions/[id]/hypotheses/[hypothesisId]` | GET | Shared Zod: id, hypothesisId + query; local body/operation schemas |
| `/api/research-sessions/[id]` | GET | Shared Zod: id + query; local body/operation schemas |
| `/api/research-targets/[id]/harness` | GET, POST | Shared Zod: id + query; local body/operation schemas |
| `/api/scan-hosts` | GET | Shared Zod: no path IDs + query; local body/operation schemas |
| `/api/scan-runs` | GET, POST | Shared Zod: no path IDs + query; local body/operation schemas |
| `/api/scan-runs/[id]/cancel` | POST | Shared Zod: id + query; local body/operation schemas |
| `/api/scan-runs/[id]/hunt` | GET | Shared Zod: id + query; local body/operation schemas |
| `/api/scan-runs/[id]/stream` | GET | Shared Zod: id + query; local body/operation schemas |
| `/api/scan-runs/[id]/summary` | GET | Shared Zod: id + query; local body/operation schemas |
| `/api/scope-assets` | GET | Shared Zod: no path IDs + query; local body/operation schemas |
| `/api/scope-assets/[id]/artifacts` | GET | Shared Zod: id + query; local body/operation schemas |
| `/api/scope-assets/[id]/history` | GET | Shared Zod: id + query; local body/operation schemas |
| `/api/scopes` | GET, POST | Shared Zod: no path IDs + query; local body/operation schemas |
| `/api/scopes/[id]/approve` | POST | Shared Zod: id + query; local body/operation schemas |
| `/api/scopes/[id]` | PATCH | Shared Zod: id + query; local body/operation schemas |
| `/api/targets` | GET, POST | Shared Zod: no path IDs + query; local body/operation schemas |
| `/api/targets/[id]/credentials/refresh` | POST | Shared Zod: id + query; local body/operation schemas |
| `/api/targets/[id]/credentials` | GET, POST, DELETE, PATCH | Shared Zod: id + query; local body/operation schemas |
| `/api/targets/[id]/credentials/test` | POST | Shared Zod: id + query; local body/operation schemas |
| `/api/targets/[id]/hunt-readiness` | GET | Shared Zod: id + query; local body/operation schemas |
| `/api/targets/[id]` | GET | Shared Zod: id + query; local body/operation schemas |
