# The file gateway (Story 1.12): a plain Node HTTP server that moves a user's private files, authorized by application-signed tickets and by a live
# database read before every chunk. It is built FROM THE REPOSITORY ROOT, because it shares two modules with the application and the one lockfile
# governs both:
#
#   docker build -f workers/files/Dockerfile -t nova3d-files .
#
# The context holds only what is copied below (.dockerignore at the root lists it): the manifest and lockfile, the two modules of lib/ that Node can run
# without the application (lib/service-signing.ts, which imports only node:crypto, and lib/canonical-json.ts, which imports nothing), and workers/files.
# TypeScript is run by Node's own type stripping: there is no build step and no compiler in the image.
#
# `npm ci --omit=dev` installs the root's production dependencies, which are more than the gateway uses (the application's own are in that list):
# a slimmer image is deferred work (deferred-work.md). The base image is named by version, not by digest, for the same reason: pinning it is deferred.
FROM node:24.21.0-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# The packages come first so that this layer is reused until a dependency changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && npm cache clean --force

COPY lib/service-signing.ts lib/canonical-json.ts ./lib/
COPY workers/files ./workers/files

# Not root: the process needs to read its own files and to listen on a port above 1024, and nothing else.
USER node

# The platform (Railway) sets PORT; 8080 when it does not.
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/healthz').then((response) => process.exit(response.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "workers/files/src/main.ts"]
