# Post-v1 route inventory

Source inventory generated 2026-11-06. This is a review index, not a claim that every route has passed browser QA. Route groups are omitted from public paths. Authentication in a page may be inherited from layouts/proxy; API handlers must also enforce their own ownership.

Pages: 21. Route handlers: 67.

## Pages

| URL | Source |
| --- | --- |
| `/hosts/[id]` | `src/app/(dashboard)/hosts/[id]/page.tsx` |
| `/hunt/[id]` | `src/app/(dashboard)/hunt/[id]/page.tsx` |
| `/hunt` | `src/app/(dashboard)/hunt/page.tsx` |
| `/recon` | `src/app/(dashboard)/recon/page.tsx` |
| `/recon/runs/[id]` | `src/app/(dashboard)/recon/runs/[id]/page.tsx` |
| `/research/history/[id]/hypotheses/[hypothesisId]` | `src/app/(dashboard)/research/history/[id]/hypotheses/[hypothesisId]/page.tsx` |
| `/research/history/[id]` | `src/app/(dashboard)/research/history/[id]/page.tsx` |
| `/research` | `src/app/(dashboard)/research/page.tsx` |
| `/scopes/[id]` | `src/app/(dashboard)/scopes/[id]/page.tsx` |
| `/scopes` | `src/app/(dashboard)/scopes/page.tsx` |
| `/settings` | `src/app/(dashboard)/settings/page.tsx` |
| `/targets/[id]/findings` | `src/app/(dashboard)/targets/[id]/findings/page.tsx` |
| `/targets/[id]` | `src/app/(dashboard)/targets/[id]/page.tsx` |
| `/targets/[id]/report` | `src/app/(dashboard)/targets/[id]/report/page.tsx` |
| `/targets/[id]/settings` | `src/app/(dashboard)/targets/[id]/settings/page.tsx` |
| `/targets` | `src/app/(dashboard)/targets/page.tsx` |
| `/research/[id]/hypotheses/[hypothesisId]` | `src/app/(research-console)/research/[id]/hypotheses/[hypothesisId]/page.tsx` |
| `/research/[id]` | `src/app/(research-console)/research/[id]/page.tsx` |
| `/login` | `src/app/login/page.tsx` |
| `/` | `src/app/page.tsx` |
| `/register` | `src/app/register/page.tsx` |

## API handlers

Methods and status literals below are extracted from source. Delegated helpers may add checks and statuses; inspect them when reviewing a handler.

| URL | Methods | Status literals | Source |
| --- | --- | --- | --- |
| `/api/ai-providers/default` | POST | 400, 401, 403 | `src/app/api/ai-providers/default/route.ts` |
| `/api/ai-providers` | GET, POST | 400, 401, 403 | `src/app/api/ai-providers/route.ts` |
| `/api/auth/[...nextauth]` | POST |  | `src/app/api/auth/[...nextauth]/route.ts` |
| `/api/evidence/[targetId]/[evidenceId]/links` | POST |  | `src/app/api/evidence/[targetId]/[evidenceId]/links/route.ts` |
| `/api/evidence/[targetId]/[evidenceId]` | GET |  | `src/app/api/evidence/[targetId]/[evidenceId]/route.ts` |
| `/api/evidence/[targetId]` | GET, POST |  | `src/app/api/evidence/[targetId]/route.ts` |
| `/api/findings/[id]/lifecycle` | GET, POST |  | `src/app/api/findings/[id]/lifecycle/route.ts` |
| `/api/findings/[id]/retest` | POST |  | `src/app/api/findings/[id]/retest/route.ts` |
| `/api/findings/[id]` | PATCH | 400, 401, 403, 404 | `src/app/api/findings/[id]/route.ts` |
| `/api/findings/[id]/validate` | POST | 400, 401, 403, 404, 409 | `src/app/api/findings/[id]/validate/route.ts` |
| `/api/findings` | GET, POST | 201, 400, 401, 403, 404 | `src/app/api/findings/route.ts` |
| `/api/health` | GET |  | `src/app/api/health/route.ts` |
| `/api/internal/recon-observations` | POST | 401 | `src/app/api/internal/recon-observations/route.ts` |
| `/api/programs/[id]/assessment` | delegated | 401, 410 | `src/app/api/programs/[id]/assessment/route.ts` |
| `/api/programs/[id]/assessment-sources/[sourceId]` | delegated | 401, 410 | `src/app/api/programs/[id]/assessment-sources/[sourceId]/route.ts` |
| `/api/programs/[id]/assessment-sources` | delegated | 401, 410 | `src/app/api/programs/[id]/assessment-sources/route.ts` |
| `/api/programs/[id]/assets/[assetId]/recon` | GET, POST | 401, 403, 404, 410 | `src/app/api/programs/[id]/assets/[assetId]/recon/route.ts` |
| `/api/programs/[id]/assets/[assetId]/research` | POST | 401, 403 | `src/app/api/programs/[id]/assets/[assetId]/research/route.ts` |
| `/api/programs/[id]/assets/[assetId]` | DELETE, PATCH | 400, 401, 403 | `src/app/api/programs/[id]/assets/[assetId]/route.ts` |
| `/api/programs/[id]/assets/[assetId]/scope.md` | GET | 401 | `src/app/api/programs/[id]/assets/[assetId]/scope.md/route.ts` |
| `/api/programs/[id]/assets/[assetId]/summary` | GET, POST |  | `src/app/api/programs/[id]/assets/[assetId]/summary/route.ts` |
| `/api/programs/[id]/assets` | GET, POST | 201, 400, 401, 403, 413 | `src/app/api/programs/[id]/assets/route.ts` |
| `/api/programs/[id]/context` | POST | 400, 401, 403 | `src/app/api/programs/[id]/context/route.ts` |
| `/api/programs/[id]/hosts/[hostId]` | DELETE, PATCH | 400, 401 | `src/app/api/programs/[id]/hosts/[hostId]/route.ts` |
| `/api/programs/[id]/hosts` | GET, POST | 201, 400, 401, 404 | `src/app/api/programs/[id]/hosts/route.ts` |
| `/api/programs/[id]/recon` | DELETE, GET, POST | 202, 401, 403, 404 | `src/app/api/programs/[id]/recon/route.ts` |
| `/api/programs/[id]` | DELETE, GET, PATCH | 400, 401, 403, 404, 409 | `src/app/api/programs/[id]/route.ts` |
| `/api/programs/[id]/scope.md` | GET | 401 | `src/app/api/programs/[id]/scope.md/route.ts` |
| `/api/programs/[id]/summary` | GET, POST |  | `src/app/api/programs/[id]/summary/route.ts` |
| `/api/programs` | GET, POST | 201, 400, 401 | `src/app/api/programs/route.ts` |
| `/api/recon/runs/[id]/report` | GET | 401, 500 | `src/app/api/recon/runs/[id]/report/route.ts` |
| `/api/register` | POST | 200, 400, 403, 429, 500, 503 | `src/app/api/register/route.ts` |
| `/api/reports` | GET, POST | 201, 400, 401, 403, 404 | `src/app/api/reports/route.ts` |
| `/api/research-coverage/[targetId]/context` | POST |  | `src/app/api/research-coverage/[targetId]/context/route.ts` |
| `/api/research-coverage/[targetId]/history` | GET |  | `src/app/api/research-coverage/[targetId]/history/route.ts` |
| `/api/research-coverage/[targetId]` | GET, POST |  | `src/app/api/research-coverage/[targetId]/route.ts` |
| `/api/research-coverage/[targetId]/sync` | POST |  | `src/app/api/research-coverage/[targetId]/sync/route.ts` |
| `/api/research-plans/[id]` | GET | 503 | `src/app/api/research-plans/[id]/route.ts` |
| `/api/research-plans/current` | GET | 503 | `src/app/api/research-plans/current/route.ts` |
| `/api/research-sessions/[id]/burp` | GET | 401, 404 | `src/app/api/research-sessions/[id]/burp/route.ts` |
| `/api/research-sessions/[id]/hypotheses/[hypothesisId]/finding-draft` | POST | 400, 401, 404 | `src/app/api/research-sessions/[id]/hypotheses/[hypothesisId]/finding-draft/route.ts` |
| `/api/research-sessions/[id]/hypotheses/[hypothesisId]` | GET | 400, 401 | `src/app/api/research-sessions/[id]/hypotheses/[hypothesisId]/route.ts` |
| `/api/research-sessions/[id]/hypotheses` | GET | 400, 401 | `src/app/api/research-sessions/[id]/hypotheses/route.ts` |
| `/api/research-sessions/[id]/hypotheses/sync` | POST | 400, 401 | `src/app/api/research-sessions/[id]/hypotheses/sync/route.ts` |
| `/api/research-sessions/[id]` | GET | 401, 404 | `src/app/api/research-sessions/[id]/route.ts` |
| `/api/research-sessions/[id]/zip` | GET | 401, 404, 409 | `src/app/api/research-sessions/[id]/zip/route.ts` |
| `/api/research-sessions` | GET, POST | 201, 400, 401 | `src/app/api/research-sessions/route.ts` |
| `/api/research-targets/[id]/console` | DELETE | 400, 401, 403, 503 | `src/app/api/research-targets/[id]/console/route.ts` |
| `/api/research-targets/[id]/recon` | GET, POST |  | `src/app/api/research-targets/[id]/recon/route.ts` |
| `/api/research-targets/[id]/terminal` | POST | 400, 401, 403, 404 | `src/app/api/research-targets/[id]/terminal/route.ts` |
| `/api/scan-hosts` | GET | 401 | `src/app/api/scan-hosts/route.ts` |
| `/api/scan-runs/[id]/cancel` | POST | 401, 404, 409, 500 | `src/app/api/scan-runs/[id]/cancel/route.ts` |
| `/api/scan-runs/[id]/hunt` | GET | 401, 404 | `src/app/api/scan-runs/[id]/hunt/route.ts` |
| `/api/scan-runs/[id]/stream` | GET | 401, 404 | `src/app/api/scan-runs/[id]/stream/route.ts` |
| `/api/scan-runs` | GET, POST | 400, 401, 404, 409, 410, 429, 500 | `src/app/api/scan-runs/route.ts` |
| `/api/scope-assets/[id]/artifacts` | GET | 400, 401, 404 | `src/app/api/scope-assets/[id]/artifacts/route.ts` |
| `/api/scope-assets/[id]/history` | GET |  | `src/app/api/scope-assets/[id]/history/route.ts` |
| `/api/scope-assets` | GET | 401 | `src/app/api/scope-assets/route.ts` |
| `/api/scopes/[id]/approve` | POST | 401, 404 | `src/app/api/scopes/[id]/approve/route.ts` |
| `/api/scopes/[id]` | PATCH | 400, 401, 404 | `src/app/api/scopes/[id]/route.ts` |
| `/api/scopes` | GET, POST | 201, 400, 401 | `src/app/api/scopes/route.ts` |
| `/api/targets/[id]/credentials/refresh` | POST | 400, 401, 404 | `src/app/api/targets/[id]/credentials/refresh/route.ts` |
| `/api/targets/[id]/credentials` | DELETE, GET, PATCH, POST | 201, 400, 401, 403, 404 | `src/app/api/targets/[id]/credentials/route.ts` |
| `/api/targets/[id]/credentials/test` | POST | 400, 401, 403, 404 | `src/app/api/targets/[id]/credentials/test/route.ts` |
| `/api/targets/[id]/hunt-readiness` | GET | 401, 410 | `src/app/api/targets/[id]/hunt-readiness/route.ts` |
| `/api/targets/[id]` | GET | 401, 404 | `src/app/api/targets/[id]/route.ts` |
| `/api/targets` | GET, POST | 201, 400, 401 | `src/app/api/targets/route.ts` |

## Milestone 3 route compatibility

No new page or API handler: `/recon?program=<id>` now opens complete server-paginated history instead of forwarding into the Target. `/recon/runs/[id]` remains the exact retained run address; optional `historyPage`/`historyPageSize` carry its return context. `/api/programs/[id]/recon?runId=<id>` adds a read-only, owner-and-Program-scoped `{id,status}` heartbeat; the existing query-free status, POST start and DELETE cancel contracts are unchanged. Anonymous API callers receive401 and private/absent history or exact-run heartbeat receives404; documents retain login redirects and Next not-found UI (a streamed shell may already have status200).
