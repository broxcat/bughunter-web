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
FROM golang:1.23.4-bookworm AS passive-tools
ENV GOTOOLCHAIN=local GOMAXPROCS=4 GOFLAGS=-p=4
RUN go install github.com/owasp-amass/amass/v4/...@v4.2.0 \
    && go install github.com/tomnomnom/assetfinder@v0.1.1 \
    && df -h / && go clean -cache -modcache && df -h /

# Nuclei 3.11.1 embeds Sonic 1.15.0: its upstream Go build tags support
# through Go 1.26. Keep the scanner release/dependencies unchanged and isolate
# the compiler, rather than patching a transitive JSON/ABI library.
FROM node:22-bookworm AS nuclei-tools
ENV GOTOOLCHAIN=local GOMAXPROCS=4 GOFLAGS=-p=4 GOPATH=/root/go
ENV PATH="/usr/local/go/bin:/root/go/bin:${PATH}"
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git build-essential wget \
    && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
    case "$(dpkg --print-architecture)" in \
      amd64) goarch=amd64; go_sha=ccfe7ae822d2c2f41f4fe7c956199967a4dac22d0ee0d2b2bfdb440aab3b20c5 ;; \
      arm64) goarch=arm64; go_sha=3f4227ce7b206a513e794f1393adb473a07b46e94d18bd15d1c684bbb7319797 ;; \
      *) echo "unsupported Nuclei architecture" >&2; exit 1 ;; \
    esac; \
    wget -q "https://go.dev/dl/go1.26.10.linux-${goarch}.tar.gz" -O /tmp/nuclei-go.tgz; \
    echo "${go_sha}  /tmp/nuclei-go.tgz" | sha256sum -c -; \
    tar -C /usr/local -xzf /tmp/nuclei-go.tgz; rm /tmp/nuclei-go.tgz; \
    go version; \
    go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@v3.11.1; \
    go version -m /root/go/bin/nuclei; \
    df -h /; go clean -cache -modcache; df -h /

FROM node:22-bookworm AS tools

ENV GO_VERSION=1.27.3
ENV GOTOOLCHAIN=local GOMAXPROCS=4 GOFLAGS=-p=4
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
        amd64) goarch=amd64; go_sha=65efbc80fdc1fa2cd2631cad5b481777a68e8725f34e89f50fc6ac714e379b40 ;; \
        arm64) goarch=arm64; go_sha=a06e99309dbcbdca1a8ccd2282c3ee146e55930886e26b4f1193269587165f49 ;; \
        *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    wget -q "https://go.dev/dl/go${GO_VERSION}.linux-${goarch}.tar.gz" -O /tmp/go.tgz; \
    echo "${go_sha}  /tmp/go.tgz" | sha256sum -c -; \
    tar -C /usr/local -xzf /tmp/go.tgz; \
    rm /tmp/go.tgz; \
    go version

# Scanner binaries land in $GOPATH/bin (= /root/go/bin).
# Compiler/module caches are build scratch, not runtime evidence. Remove them
# before each layer is committed so the hosted runner need not store/export
# several copies. Pinned binaries and the offline smoke gate stay unchanged.
RUN set -eux; \
    go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@v2.17.0; \
    go install github.com/projectdiscovery/httpx/cmd/httpx@v1.12.0; \
    go install github.com/projectdiscovery/katana/cmd/katana@v1.8.0; \
    go install github.com/projectdiscovery/dnsx/cmd/dnsx@v1.3.1; \
    go install github.com/ffuf/ffuf/v2@v2.1.0; \
    go install github.com/lc/gau/v2/cmd/gau@v2.2.4; \
    go install github.com/hahwul/dalfox/v2@v2.13.0; \
    df -h /; go clean -cache -modcache; df -h /

# Independent layer preserves the expensive existing scanner build cache.
RUN GOMAXPROCS=2 go install github.com/OJ/gobuster/v3@v3.8.2 \
    && df -h / && go clean -cache -modcache && df -h /

# Pre-pull nuclei templates into the image (written to /root/nuclei-templates
# and /root/.config/nuclei); copied into the runtime stage below.
RUN git clone --depth 1 --branch v10.5.1 https://github.com/projectdiscovery/nuclei-templates.git /root/nuclei-templates \
    && test "$(git -C /root/nuclei-templates rev-parse HEAD)" = 79fb682760ab3d5b0e22afbb44709353cbebf023 \
    && mkdir -p /root/.config/nuclei
COPY --from=passive-tools /go/bin/amass /go/bin/assetfinder /root/go/bin/
COPY --from=nuclei-tools /root/go/bin/nuclei /root/go/bin/nuclei
# Network-free functional proof, including all four permitted Recon templates.
COPY scripts/recon/toolchain-smoke.mjs /opt/bughunter/toolchain-smoke.mjs
COPY src/server/recon/templates/ /opt/bughunter/recon-templates/
RUN --network=none RECON_SMOKE_BIN=/root/go/bin RECON_SMOKE_TEMPLATES=/opt/bughunter/recon-templates node /opt/bughunter/toolchain-smoke.mjs

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
# Seed the shared research volume correctly even when web starts before the runner.
RUN install -d -o 0 -g 2000 -m 3770 /research-workspaces
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
# Audit the actual runtime libraries, architecture, resources and writable tmp.
# This manifest is an image artifact; each run also captures a fresh doctor report.
RUN --network=none npm run recon:doctor -- --strict --output /app/recon-tool-manifest.json

EXPOSE 3000

# `web` service uses this default; `worker` overrides with `npm run worker`.
CMD ["npm", "run", "start"]
