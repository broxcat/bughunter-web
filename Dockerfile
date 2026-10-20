# syntax=docker/dockerfile:1
#
# bughunter-web — single image used by BOTH the `web` (next start) and
# `worker` (tsx scan worker) compose services. Multi-stage:
#
#   tools    -> Go scanner binaries (ProjectDiscovery + friends) + nmap deps
#   deps     -> npm ci (full deps; tsx is a devDependency the worker needs)
#   builder  -> prisma generate + next build
#   runtime  -> scanner binaries + nmap + the built app
#
# IMPORTANT: this Dockerfile assumes NORMAL internet access at build time
# (go install, apt-get, npm ci, prisma engine download, nuclei template pull).
# A sandbox that blocks outbound network is a DEV-ENVIRONMENT limitation, NOT a
# production constraint — do not redesign this to work offline.

# ---------------------------------------------------------------------------
# Stage 1: scanner tools — Go toolchain + ProjectDiscovery suite + CLI deps
# ---------------------------------------------------------------------------
FROM node:22-bookworm AS tools

ENV GO_VERSION=1.23.4
ENV GOPATH=/root/go
ENV PATH="/usr/local/go/bin:/root/go/bin:${PATH}"

RUN apt-get update && apt-get install -y --no-install-recommends \
        nmap \
        jq \
        git \
        ca-certificates \
        build-essential \
        python3 \
        wget \
    && rm -rf /var/lib/apt/lists/*

# Go toolchain (arch-aware so this builds on amd64 and arm64 hosts).
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
        amd64) goarch=amd64 ;; \
        arm64) goarch=arm64 ;; \
        *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    wget -q "https://go.dev/dl/go${GO_VERSION}.linux-${goarch}.tar.gz" -O /tmp/go.tgz; \
    tar -C /usr/local -xzf /tmp/go.tgz; \
    rm /tmp/go.tgz; \
    go version

# Scanner binaries land in $GOPATH/bin (= /root/go/bin).
RUN set -eux; \
    go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest; \
    go install github.com/projectdiscovery/httpx/cmd/httpx@latest; \
    go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest; \
    go install github.com/projectdiscovery/katana/cmd/katana@latest; \
    go install github.com/projectdiscovery/dnsx/cmd/dnsx@latest; \
    go install github.com/ffuf/ffuf/v2@latest; \
    go install github.com/lc/gau/v2/cmd/gau@latest; \
    go install github.com/hahwul/dalfox/v2@latest

# Pre-pull nuclei templates into the image (written to /root/nuclei-templates
# and /root/.config/nuclei); copied into the runtime stage below.
RUN nuclei -update-templates

# ---------------------------------------------------------------------------
# Stage 2: node dependencies (full install — devDeps included; worker uses tsx)
# ---------------------------------------------------------------------------
FROM node:22-bookworm AS deps
WORKDIR /app
# Pin the Playwright browser cache to a fixed, stage-shared path so the runtime
# stage can COPY the Chromium binary to the IDENTICAL location (otherwise it
# defaults to the invoking user's ~/.cache/ms-playwright and the paths drift).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package.json package-lock.json ./
RUN npm ci
# Download the headless Chromium build the worker's DOM-XSS confirmer drives.
# The browser version is locked to the playwright-chromium version from npm ci.
# As with the rest of this file, this assumes NORMAL internet at build time.
RUN npx playwright install chromium

# ---------------------------------------------------------------------------
# Stage 3: app build — prisma client generation + next build (Turbopack)
# ---------------------------------------------------------------------------
FROM node:22-bookworm AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate the Prisma client into node_modules/.prisma (carried to runtime).
RUN npx prisma generate

# Placeholder env ONLY for `next build` so any server module evaluated during
# the build does not crash on missing config. These values are never used at
# runtime — real values come from env_file (.env) in docker-compose.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public" \
    REDIS_URL="redis://localhost:6379" \
    AUTH_SECRET="build-time-placeholder" \
    AUTH_URL="http://localhost:3000" \
    CREDENTIALS_ENCRYPTION_KEY="0000000000000000000000000000000000000000000000000000000000000000"

RUN npm run build

# ---------------------------------------------------------------------------
# Stage 4: runtime — built app + scanner binaries + nmap, for web AND worker
# ---------------------------------------------------------------------------
FROM node:22-bookworm AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Runtime deps for the scanners (nmap for -sV/SYN scans, plus common CLI tools)
# AND the shared libraries headless Chromium needs — the worker launches it via
# playwright-chromium to confirm DOM-XSS. Package names are the Debian 12
# (bookworm, this base image) spellings. Assumes NORMAL internet at build time.
RUN apt-get update && apt-get install -y --no-install-recommends \
        nmap \
        jq \
        git \
        ca-certificates \
        python3 \
        libnss3 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libcups2 \
        libdrm2 \
        libxkbcommon0 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxrandr2 \
        libgbm1 \
        libasound2 \
        libpango-1.0-0 \
        libcairo2 \
        fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Go scanner binaries (subfinder, httpx, nuclei, katana, dnsx, ffuf, gau, dalfox).
COPY --from=tools /root/go/bin/ /usr/local/bin/
# nuclei templates + config so `nuclei` runs without a first-boot network pull.
COPY --from=tools /root/nuclei-templates /root/nuclei-templates
COPY --from=tools /root/.config/nuclei /root/.config/nuclei
# Headless Chromium browser binary (downloaded in the deps stage) at the same
# PLAYWRIGHT_BROWSERS_PATH the worker reads, so playwright-chromium finds it.
COPY --from=deps /ms-playwright /ms-playwright

# The built application: node_modules (incl. generated Prisma client), .next,
# src (the tsx worker runs TS source directly), prisma, and config files.
COPY --from=builder /app /app

EXPOSE 3000

# `web` service uses this default; `worker` overrides with `npm run worker`.
CMD ["npm", "run", "start"]
