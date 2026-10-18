# The heartbeat task (Story 1.13): a Node cron job that signs one heartbeat, posts it to the application and exits. Railway runs it every 30 minutes (a cron
# schedule set by hand on the service: docs/staging.md). It is built FROM THE REPOSITORY ROOT, because it shares one module with the application and the one
# lockfile governs every worker:
#
#   docker build -f workers/heartbeat/Dockerfile -t nova3d-heartbeat .
#
# The context holds only what is copied below (.dockerignore at the root lists it): the manifest and lockfile, lib/service-signing.ts (which imports only
# node:crypto) and workers/heartbeat. TypeScript is run by Node's own type stripping: there is no build step and no compiler in the image. The task imports no
# package at all; `npm ci --omit=dev` is kept so that the lockfile is installed exactly as every other worker's is (a package it starts to import is then already
# a production dependency, which tests/unit/gate-structure.test.ts checks). The task holds one secret, its own signing key, and listens on nothing.
FROM node:24.21.0-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# The packages come first so that this layer is reused until a dependency changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && npm cache clean --force

COPY lib/service-signing.ts ./lib/
COPY workers/heartbeat ./workers/heartbeat

# Not root: the process reads its own files and makes one request, and nothing else.
USER node

# A cron job: it runs, prints one line and exits (0 when the application recorded the heartbeat, 1 otherwise). No port, no health check.
CMD ["node", "workers/heartbeat/src/main.ts"]
