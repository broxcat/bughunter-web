# bughunter-web

Web dashboard for the **Agentic-Bug-Hunter** CLI: an authorization-gated bug-bounty
workflow — declare scope → approve it → recon/hunt → findings → triage gate → report.

> **Security invariant (non-negotiable, every layer):** no scanner ever runs against a
> target unless that target's `Scope` is `APPROVED`. The check happens when a Target is
> created **and again** in the worker immediately before any tool is spawned (a scope can
> be revoked between enqueue and execution). This is the authorization attestation; no
> part of the app may relax it.

## Stack

- **Next.js 16** (App Router) + React 19, TypeScript end to end
- **PostgreSQL** + **Prisma 6**
- **Redis** + **BullMQ** (serialized scan queue + live log pub/sub)
- **Auth.js v5** (NextAuth beta) — credentials + optional GitHub/Google
- **Tailwind v4** (via `@tailwindcss/turbopack` — no `postcss.config`; `next build` uses Turbopack)
- **Docker** for the scanner runtime (nmap, nuclei, httpx, katana, subfinder, …)

## Run

```bash
cp .env.example .env            # fill AUTH_SECRET, CREDENTIALS_ENCRYPTION_KEY, etc.
docker compose up --build       # web + worker + postgres + redis
# first boot: run migrations inside the web container
docker compose exec web npx prisma migrate deploy
```

Local dev without Docker: a Postgres + Redis reachable via `DATABASE_URL`/`REDIS_URL`, then
`npm run dev` (app) and `npm run worker` (scan worker) in two terminals.

> Note: `npx prisma generate` runs fine here; if an offline/sandboxed environment blocks the
> engine download, that's an environment issue, not a code one — skip it and continue.

## Prisma models (the frozen Phase-0 contract)

| Model | One-liner |
|---|---|
| `User` / `Account` / `Session` / `VerificationToken` | Auth.js standard; `User.passwordHash` for credentials login |
| `AiProviderConfig` | Per-user AI provider; API key stored **encrypted** (`apiKeyCipher`), never returned to the client |
| `Scope` | Authorization record (`hostPattern`, `justification`, status `PENDING`/`APPROVED`/`REVOKED`) |
| `Target` | A host to test; references a Scope that must be `APPROVED` |
| `ScanRun` | One recon/hunt/validate execution (`type`, `status`, BullMQ `jobId`) |
| `ScanLog` | Append-only scan output line (`stream` STDOUT/STDERR), streamed over SSE |
| `Finding` | A result + triage gate (`gateStatus` UNVALIDATED/PASSED/KILLED, `gateAnswers` JSON) |
| `Report` / `ReportItem` | A report and its items — items may reference **PASSED findings only** |

**`prisma/schema.prisma` is frozen after Phase 0.** Phase 1 agents must not edit it; a missing
field is requested in the agent's final report, and the lead adds it once at the end of Phase 1.

## Agent Teams ownership map (Phase 1 — disjoint file sets, built in parallel)

| Agent | Owns (writes only these) |
|---|---|
| **AUTH** | `src/lib/auth.ts`, `src/middleware.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/app/api/register/route.ts`, `src/app/login/page.tsx`, `src/app/register/page.tsx`, `src/types/next-auth.d.ts` |
| **DOCKER** | `Dockerfile`, `docker-compose.yml`, `.env.example` (add only), `docker/` |
| **QUEUE** | `src/server/queue/{connection,scanQueue,logBus,worker}.ts`, `src/server/scanners/{runCommand,recon,hunt}.ts` |
| **REALTIME** | `src/app/api/scan-runs/[id]/stream/route.ts`, `src/components/ScanLogViewer.tsx` |
| **UI** | `src/app/(dashboard)/**`, `src/app/api/{scopes,targets,findings}/**`, `src/app/api/scan-runs/route.ts`, `src/app/api/reports/route.ts`, `src/lib/{gate,reportTemplates}.ts`, `src/app/page.tsx` |
| **SETTINGS** | `src/lib/crypto.ts`, `src/app/api/ai-providers/route.ts`, `src/app/(dashboard)/settings/page.tsx` |

Shared, owned by the lead (do not edit as a teammate): `prisma/schema.prisma`, `src/lib/prisma.ts`,
`package.json`, `tsconfig.json`, `next.config.ts`.

### Cross-agent interface contracts (code against these; don't reach into another agent's files)

- **Prisma client:** `import { prisma } from "@/lib/prisma"`.
- **Auth:** `import { auth } from "@/lib/auth"`; `const session = await auth()`; user id at `session.user.id`.
- **Scan job data (QUEUE ↔ UI):** `scanQueue.add("scan", { scanRunId: string, targetId: string, type: "RECON"|"HUNT"|"VALIDATE" })`.
- **Log bus (QUEUE ↔ REALTIME):** in `src/server/queue/logBus.ts` —
  `publishScanLog(scanRunId, { line, stream, createdAt })` and
  `subscribeScanLog(scanRunId, cb): Promise<() => void>` (returns an unsubscribe fn).
- **Worker script:** `npm run worker` → `tsx src/server/queue/worker.ts` (already in package.json).
- **Crypto (SETTINGS):** `encryptSecret(plain): string` / `decryptSecret(cipher): string` in `src/lib/crypto.ts`,
  keyed by `process.env.CREDENTIALS_ENCRYPTION_KEY`.
- **No `npm install` in teammates:** all deps are already installed (prisma, @prisma/client,
  next-auth, @auth/prisma-adapter, bullmq, ioredis, bcryptjs, zod, tsx). Need another? Note it in
  your report instead of installing (avoids corrupting the shared lockfile).
- **Verify your own files** with `npx tsc --noEmit`; the lead runs the full `npm run build` after merge.

## Build order

Phase 0 (lead, done) → Phase 1 (6 teammates, parallel, disjoint files) → lead merges &
`npm run build` → Phase 2 (port the Python `hunt.py`/`validate.py`/`brain.py` engine; solo,
needs the CLI repo link).
