FROM node:24-bookworm-slim
# Current npm stable verified 2026-10-27; explicit version for repeatable builds.
ARG CODEX_VERSION=0.164.0
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-server git curl jq python3 ripgrep ca-certificates procps less \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @openai/codex@${CODEX_VERSION} \
    && codex --version && codex --help \
    && codex --yolo --help >/dev/null \
    && groupadd -g 2000 research \
    && useradd -m -u 2000 -g research -s /bin/bash researcher \
    && passwd -d researcher \
    && install -d -m 0755 /run/sshd /etc/ssh/host-keys \
    && install -d -o root -g research -m 3770 /workspaces \
    && install -d -o researcher -g research -m 0700 /home/researcher/.codex \
    && rm -f /etc/ssh/ssh_host_*
# Same central Zod contract as the web app; no application dependencies/secrets.
COPY docker/research/validator/package*.json /opt/bughunter/
RUN npm ci --omit=dev --ignore-scripts --prefix /opt/bughunter
COPY src/lib/research/hypotheses.ts /opt/bughunter/hypotheses.ts
COPY docker/research/validator/validate-hypotheses.mjs /opt/bughunter/validate-hypotheses.mjs
COPY --chmod=755 docker/research/bughunter-validate-hypotheses /usr/local/bin/
COPY docker/research/sshd_config /etc/ssh/sshd_config
COPY --chmod=755 docker/research/entrypoint docker/research/healthcheck /usr/local/bin/
COPY --chmod=755 docker/research/bughunter-codex docker/research/bughunter-workspaces /usr/local/bin/
COPY docker/research/banner /etc/motd
RUN printf '\nif [ -t 1 ]; then bughunter-workspaces; fi\n' >> /home/researcher/.bashrc
EXPOSE 22
HEALTHCHECK --interval=30s --start-period=10s --timeout=5s CMD ["healthcheck"]
ENTRYPOINT ["entrypoint"]
