FROM node:22-bookworm AS browser
WORKDIR /browser
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npm init -y && npm install --save-exact playwright-chromium@1.64.1 && npx playwright install-deps chromium
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid app --create-home app && mkdir /run/browser && chown app:app /run/browser
COPY server.mjs /browser/server.mjs
USER app
CMD ["node", "/browser/server.mjs"]
