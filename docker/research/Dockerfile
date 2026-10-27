# Official proxy sources only, built by the upstream Gradle wrapper at an exact revision.
FROM eclipse-temurin:21-jdk-jammy AS burp-proxy
ARG MCP_PROXY_REVISION=34183a803e3b309988f463f79f7c307a44714af5
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN git init /build && cd /build && git remote add origin https://github.com/PortSwigger/mcp-proxy.git \
    && git fetch --depth 1 origin ${MCP_PROXY_REVISION} && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "$MCP_PROXY_REVISION" \
    && ./gradlew --no-daemon shadowJar \
    && cp build/libs/mcp-proxy-all.jar /mcp-proxy-all.jar

FROM node:24-bookworm-slim AS research-skills
ARG SKILLS_REVISION=b7f6ad814a903f912962ea3cccad8c02766f753b
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN git init /skills && cd /skills && git remote add origin https://github.com/sickn33/agentic-awesome-skills.git \
    && git sparse-checkout init --cone && git sparse-checkout set skills/web-security-testing skills/api-fuzzing-bug-bounty skills/idor-testing skills/ffuf-web-fuzzing \
    && git fetch --filter=blob:none --depth 1 origin ${SKILLS_REVISION} && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "$SKILLS_REVISION" \
    && mkdir /installed \
    && for name in web-security-testing api-fuzzing-bug-bounty idor-testing ffuf-web-fuzzing; do \
      test -f "skills/$name/SKILL.md" && cp -a "skills/$name" /installed/; done \
    && cd /installed && find . -type f -exec sha256sum {} + | sort > /skills.sha256 \
    && cp /skills/LICENSE /installed/UPSTREAM-LICENSE && cp /skills/LICENSE-CONTENT /installed/UPSTREAM-LICENSE-CONTENT

FROM eclipse-temurin:21-jre-jammy AS java-runtime

FROM node:24-bookworm-slim
# Official npm stable checked during implementation; never install @latest at runtime.
ARG CODEX_VERSION=0.165.0
ARG RESEARCH_WORKSPACE_UID=1000
ARG RESEARCH_WORKSPACE_GID=1000
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-server git curl jq python3 ripgrep ca-certificates procps less tmux util-linux \
    build-essential \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @openai/codex@${CODEX_VERSION} \
    && codex --version && codex --help && codex --yolo --help >/dev/null \
    && groupmod -n research -g ${RESEARCH_WORKSPACE_GID} node \
    && usermod -l researcher -d /home/researcher -m -g research -u ${RESEARCH_WORKSPACE_UID} -s /bin/bash node \
    && passwd -d researcher \
    && install -d -m 0755 /run/sshd /etc/ssh/host-keys /etc/bughunter \
    && install -d -o root -g research -m 3770 /workspaces \
    && install -d -o researcher -g research -m 0700 /home/researcher/.codex \
    && rm -f /etc/ssh/ssh_host_*
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY docker/research/validator/package*.json /opt/bughunter/
RUN npm ci --omit=dev --prefix /opt/bughunter \
    && /opt/bughunter/node_modules/.bin/playwright install --with-deps chromium \
    && /opt/bughunter/node_modules/.bin/playwright-mcp --version
# Use the matching headless shell, without Chrome account/updater background traffic.
RUN shell_path="$(find /ms-playwright -type f -name chrome-headless-shell)" \
    && test -x "$shell_path" && ln -s "$shell_path" /usr/local/bin/bughunter-chromium
COPY --from=java-runtime /opt/java/openjdk /opt/java/openjdk
RUN ln -s /opt/java/openjdk/bin/java /usr/bin/java && java -version
COPY --from=burp-proxy /mcp-proxy-all.jar /opt/portswigger/mcp-proxy-all.jar
COPY --from=research-skills /installed/ /etc/codex/skills/
COPY --from=research-skills /skills.sha256 /etc/codex/skills.sha256
RUN cd /etc/codex/skills && sha256sum --check ../skills.sha256 \
    && chmod -R a-w /etc/codex/skills
# Shared contracts and small runner helpers only; never copy the application source.
COPY src/lib/research/hypotheses.ts src/lib/research/burp.ts src/lib/research/terminal.ts src/lib/research/consolePolicy.ts /opt/bughunter/src/lib/research/
COPY src/lib/observationSafety.ts src/lib/httpPolicy.mjs /opt/bughunter/src/lib/
COPY docker/research/validator/*.mjs docker/research/validator/*.cjs /opt/bughunter/docker/research/validator/
COPY docker/research/console/ /opt/bughunter/docker/research/console/
COPY --chmod=755 docker/research/bughunter-* /usr/local/bin/
COPY docker/research/sshd_config /etc/ssh/sshd_config
COPY docker/research/tmux.conf /etc/bughunter/tmux.conf
COPY --chmod=755 docker/research/entrypoint docker/research/healthcheck docker/research/console-entrypoint docker/research/console-healthcheck /usr/local/bin/
COPY docker/research/banner /etc/motd
RUN if [ "$RESEARCH_WORKSPACE_GID" != 2000 ]; then groupadd -g 2000 research-legacy && usermod -aG research-legacy researcher; fi
EXPOSE 22 7681
HEALTHCHECK --interval=30s --start-period=10s --timeout=5s CMD ["console-healthcheck"]
ENTRYPOINT ["console-entrypoint"]
