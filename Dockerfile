# Clawco in a container (KC-0157): the second reference install after deploy/install.sh.
# KC-0245: it runs Clawco's built-in agent (KC_AGENT=direkte): the only thing it needs is a model key, pasted in Start.
#   docker compose up -d            → http://127.0.0.1:8750 on this machine only (compose.yaml)
#   node scripts/docker-tjek.mjs    → build, cold start, Nu with a real element, cleanup (spec §10)
# No build step: Node 24 runs the TypeScript directly (AGENTS.md §2). The user folder is the
# volume /data; the app writes nowhere else (compose runs the root filesystem read-only).
# KC-0276 (F6): the exact Node release (the one the code is developed on), not the moving 24 tag. Pinning by digest
# needs Docker to read it; follow-up.
FROM node:24.22.1-bookworm-slim

ENV NODE_ENV=production

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY src ./src
COPY public ./public
COPY config ./config
# The scripted agent's mail fixtures (KC_AGENT=fake reads them at start); nothing else from test/.
COPY test/fixtures ./test/fixtures
# KC-0245: the entrypoint that makes the key file for the encrypted model-key store the first time.
COPY deploy/docker/start.sh /usr/local/bin/clawco-start.sh

# /health shows this sha: the image has no .git, so src/server.ts gitSha() reads /app/GIT_SHA.
# Without the arg the file is empty and /health says "unknown".
ARG GIT_SHA
RUN printf '%s\n' "$GIT_SHA" > GIT_SHA \
 && mkdir -p /data /noegle \
 && chown node:node /data /noegle

# Defaults for a fresh container; compose.yaml or `docker run -e` override them.
# KC_HOST: listen on the container's interface; only compose's 127.0.0.1 publish makes it reachable.
# KC_AGENT: not set here (KC-0245): start.sh picks the built-in agent (direkte) for a new container, as install.sh
#   does, and keeps Hermes (hermes-http) for one that already used it (KC_HERMES_URL set, or a Hermes key saved in
#   Start). Nu works, Start asks for a model key (or a local model). Set KC_AGENT to choose yourself.
# KC_HEMMELIGHEDER_FIL: the key that encrypts the model keys saved in Start (in /data/hemmeligheder.enc). It lives on
#   its own volume /noegle, outside /data, so a copy of the data volume never carries it; start.sh makes it once.
# KC_ENV_FILE: where Start saves keys; read again at start (CMD), and it lives in the user folder.
# KC_TEST_DATA_DIR: the fictional test world is scratch, never the user's (KC-0068).
# KC_KALENDER_SCRIPT: empty = no week view (the bundled script needs Python and Kira's token script).
ENV KC_HOST=0.0.0.0 \
    KC_PORT=8750 \
    KC_DATA_DIR=/data \
    KC_ENV_FILE=/data/.env \
    KC_HEMMELIGHEDER_FIL=/noegle/hemmeligheder.key \
    KC_TEST_DATA_DIR=/tmp/clawco-test \
    KC_KALENDER_SCRIPT=

USER node
VOLUME /data
VOLUME /noegle
EXPOSE 8750

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.KC_PORT || 8750) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

ENTRYPOINT ["sh", "/usr/local/bin/clawco-start.sh"]
CMD ["sh", "-c", "exec node --env-file-if-exists=\"$KC_ENV_FILE\" src/server.ts"]
