# Official extension and its bundled proxy are an audited pair, not latest downloads.
FROM eclipse-temurin:21-jdk-jammy AS extension
ARG BURP_MCP_REVISION=ff10ffe6df163fb8519aadb4c26da4eb5d8ebe2b
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN git init /build && cd /build && git remote add origin https://github.com/PortSwigger/mcp-server.git \
    && git fetch --depth 1 origin ${BURP_MCP_REVISION} && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "$BURP_MCP_REVISION" \
    && echo '6e70ebf2f4367f54c1e8a8ba94de89ba843773851de743bcfccb1e8aa23f796a  libs/mcp-proxy-all.jar' | sha256sum -c - \
    && ./gradlew --no-daemon -Dorg.gradle.jvmargs=-Xmx1g embedProxyJar

FROM eclipse-temurin:25-jre-jammy
ARG BURP_VERSION=2026.10.1
ARG BURP_SHA256=e8ab086537b1643b91ca09d2fc2a6c3e08a8bae0c85280797c5c9ec76506c3c5
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates xvfb xdotool python3 libxi6 libxrender1 libxtst6 libfreetype6 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -u 1000 burp && mkdir -p /opt/burp /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix \
    && curl -fL "https://portswigger.net/burp/releases/download?product=desktop&version=${BURP_VERSION}&type=Jar" -o /opt/burp/burpsuite.jar \
    && echo "$BURP_SHA256  /opt/burp/burpsuite.jar" | sha256sum -c -
COPY --from=extension /build/build/libs/burp-mcp-all.jar /opt/burp/burp-mcp-all.jar
COPY docker/burp/user-options.json docker/burp/bootstrap.py docker/burp/forward.py /opt/burp/
COPY --chmod=755 docker/burp/entrypoint /usr/local/bin/burp-entrypoint
USER burp
WORKDIR /home/burp
ENV DISPLAY=:99
# No EXPOSE, remote desktop, public MCP, or application credentials.
ENTRYPOINT ["burp-entrypoint"]
