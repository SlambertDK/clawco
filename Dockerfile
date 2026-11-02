# Clawco in a container (KC-0157): the second reference install after deploy/install.sh.
#   docker compose up -d            → http://127.0.0.1:8750 on this machine only (compose.yaml)
#   node scripts/docker-tjek.mjs    → build, cold start, Nu with a real element, cleanup (spec §10)
# No build step: Node 24 runs the TypeScript directly (AGENTS.md §2). The user folder is the
# volume /data; the app writes nowhere else (compose runs the root filesystem read-only).
FROM node:24-bookworm-slim

ENV NODE_ENV=production

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY src ./src
COPY public ./public
COPY config ./config
# The scripted agent's mail fixtures (KC_AGENT=fake reads them at start); nothing else from test/.
COPY test/fixtures ./test/fixtures

# /health shows this sha: the image has no .git, so src/server.ts gitSha() reads /app/GIT_SHA.
# Without the arg the file is empty and /health says "unknown".
ARG GIT_SHA
RUN printf '%s\n' "$GIT_SHA" > GIT_SHA \
 && mkdir -p /data \
 && chown node:node /data

# Defaults for a fresh container; compose.yaml or `docker run -e` override them.
# KC_HOST: listen on the container's interface; only compose's 127.0.0.1 publish makes it reachable.
# KC_AGENT: the keyless real agent, as install.sh starts (KC-0127): Nu works, Start asks for the key.
# KC_ENV_FILE: where Start saves keys; read again at start (CMD), and it lives in the user folder.
# KC_TEST_DATA_DIR: the fictional test world is scratch, never the user's (KC-0068).
# KC_KALENDER_SCRIPT: empty = no week view (the bundled script needs Python and Kira's token script).
ENV KC_HOST=0.0.0.0 \
    KC_PORT=8750 \
    KC_DATA_DIR=/data \
    KC_ENV_FILE=/data/.env \
    KC_AGENT=hermes-http \
    KC_TEST_DATA_DIR=/tmp/clawco-test \
    KC_KALENDER_SCRIPT=

USER node
VOLUME /data
EXPOSE 8750

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.KC_PORT || 8750) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["sh", "-c", "exec node --env-file-if-exists=\"$KC_ENV_FILE\" src/server.ts"]
