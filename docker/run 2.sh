#!/usr/bin/env bash
# Container entry (docker/Dockerfile): run the kit's site (/kit/site, read-only mount) against the project (/docs).
#   run.sh build | dev
set -euo pipefail
WORK=/tmp/docs-kit-site
rm -rf "$WORK" && mkdir -p "$WORK"
# the site's source from the mounted kit, the packages from the image
(cd /kit/site && tar --exclude=node_modules --exclude=.astro -cf - .) | tar -C "$WORK" -xf -
ln -s /opt/site/node_modules "$WORK/node_modules"
export DOCS_KIT=/kit DOCS_ROOT=/docs ASTRO_TELEMETRY_DISABLED=1
cd "$WORK"
case "${1:-build}" in
  build) exec node node_modules/astro/bin/astro.mjs build ;;
  dev)   exec node node_modules/astro/bin/astro.mjs dev --host 0.0.0.0 --port "${DOCS_PORT:-8000}" ;;
  *)     echo "usage: run.sh build | dev" >&2; exit 2 ;;
esac
