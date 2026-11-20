# docs-kit site image: Node LTS + the site's packages (prd.md §6.1). bin/docs.sh builds it once
# (tag docs-kit-site:<hash of site/package-lock.json, this file and run.sh>) and then runs offline: the project is
# mounted at /docs, the kit at /kit (read-only); run.sh copies /kit/site next to the packages and runs Astro.
# Build context: the kit root.  docker build -t docs-kit-site -f docker/Dockerfile .
# Pin by digest for a mirror: FROM node:24-bookworm-slim@sha256:<digest>
FROM node:24-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV ASTRO_TELEMETRY_DISABLED=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

WORKDIR /opt/site
COPY site/package.json site/package-lock.json ./
RUN npm ci --no-audit --no-fund --loglevel=error && chmod -R a+rX /opt/site

COPY docker/run.sh /opt/run.sh
RUN chmod 755 /opt/run.sh
ENTRYPOINT ["/opt/run.sh"]
