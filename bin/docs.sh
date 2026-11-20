#!/usr/bin/env bash
# Serve or build a project's docs site (docs-kit, Astro edition). Run from anywhere; the project is the directory
# that contains .docs-kit/ (or DOCS_ROOT).
#
#   .docs-kit/bin/docs.sh start     run the preview in the background (Docker: survives logout and reboot)
#   .docs-kit/bin/docs.sh stop      stop the background preview
#   .docs-kit/bin/docs.sh status    show whether it is running and the URLs to open
#   .docs-kit/bin/docs.sh logs      follow the preview log (Ctrl-C to quit)
#   .docs-kit/bin/docs.sh serve     run the preview in the foreground (Ctrl-C to stop)
#   .docs-kit/bin/docs.sh build [--strict]   write the static site to build/site/ (--strict: fail on any WARNING)
#
# Env: DOCS_PORT (default 8000), DOCS_ROOT (project root; default: the parent of the kit directory),
#      DOCS_RUNNER (docker | host; default docker when the docker daemon answers, else host),
#      DOCS_IMAGE (docker: image with Node and the site's packages; default docs-kit-site:<lockfile hash>, built from
#      docker/Dockerfile on first use - that one build needs the network or a registry mirror)
# host runner: Node >= 22.18 on the host; the first run installs the site's packages (npm ci) into .docs-kit/site/.
# The preview re-reads docs/, docs-kit.yml and the kit's assets/ on change; after editing the kit's site/ code restart.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "${DOCS_ROOT:-$(dirname "$KIT")}" && pwd)"
PORT="${DOCS_PORT:-8000}"
NAME="docs-$(basename "$ROOT" | tr -c 'A-Za-z0-9_.\n-' '-')"
SITE="$KIT/site"
CMD="${1:-}"
STRICT=0
[[ "${2:-}" == "--strict" ]] && STRICT=1

[[ -f "$ROOT/docs-kit.yml" || -f "$ROOT/mkdocs.yml" ]] || {
  echo "ERROR: no docs-kit.yml in $ROOT (run .docs-kit/bin/kit.py init first)" >&2; exit 1; }

runner="${DOCS_RUNNER:-}"
if [[ -z "$runner" ]]; then
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then runner=docker; else runner=host; fi
fi

urls() {
  local base
  base="$(python3 - "$ROOT" <<'PY' 2>/dev/null || true
import re, sys
try:
    t = open(sys.argv[1] + "/docs-kit.yml", encoding="utf-8").read()
    m = re.search(r"^\s+base:\s*['\"]?([^'\"#\s]+)", t, re.M)
    print(("/" + m.group(1).strip("/") + "/") if m and m.group(1).strip("/") else "/")
except OSError:
    print("/")
PY
)"
  base="${base:-/}"
  echo "  http://localhost:$PORT$base"
  for ip in $(hostname -I 2>/dev/null); do
    case "$ip" in 172.17.*|172.18.*|*.0|*:*) ;; *) echo "  http://$ip:$PORT$base" ;; esac
  done
}

# ---------------------------------------------------------------- host runner (Node on this machine)
host_deps() {
  command -v node >/dev/null 2>&1 || { echo "ERROR: DOCS_RUNNER=host needs Node >= 22.18 (or use Docker)" >&2; exit 1; }
  if [[ ! -d "$SITE/node_modules" || "$SITE/package-lock.json" -nt "$SITE/node_modules/.package-lock.json" ]]; then
    echo "installing the site's packages (npm ci in $SITE) ..."
    (cd "$SITE" && npm ci --no-audit --no-fund --loglevel=error)
  fi
}
host_env() { export DOCS_ROOT="$ROOT" DOCS_KIT="$KIT" ASTRO_TELEMETRY_DISABLED=1 DOCS_STRICT="$STRICT"; }

# ---------------------------------------------------------------- docker runner
image() {
  local h
  h="$( (cat "$SITE/package-lock.json" "$KIT/docker/Dockerfile" "$KIT/docker/run.sh") | (sha256sum 2>/dev/null || shasum -a 256) | cut -c1-12)"
  echo "${DOCS_IMAGE:-docs-kit-site:$h}"
}
ensure_image() {
  local img; img="$(image)"
  if ! docker image inspect "$img" >/dev/null 2>&1; then
    if [[ -n "${DOCS_IMAGE:-}" ]]; then docker pull "$img"; else
      echo "building $img (Node + the site's packages; once) ..."
      docker build -q -t "$img" -f "$KIT/docker/Dockerfile" "$KIT" >/dev/null
    fi
  fi
  echo "$img"
}
docker_run() { # args: extra docker args... -- run.sh args...
  local img; img="$(ensure_image)"
  local pre=() post=()
  while [[ $# -gt 0 && "$1" != "--" ]]; do pre+=("$1"); shift; done
  shift || true; post=("$@")
  docker run --user "$(id -u):$(id -g)" -e HOME=/tmp -e DOCS_STRICT="$STRICT" \
    -v "$ROOT:/docs" -v "$KIT:/kit:ro" "${pre[@]}" "$img" "${post[@]}"
}
docker_running() { [[ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" == "true" ]]; }

case "$runner:$CMD" in
  host:build)
    host_deps; host_env
    cd "$SITE" && exec node node_modules/astro/bin/astro.mjs build
    ;;
  host:serve)
    host_deps; host_env
    echo "serving on:"; urls
    cd "$SITE" && exec node node_modules/astro/bin/astro.mjs dev --host 0.0.0.0 --port "$PORT"
    ;;
  host:start)
    host_deps; host_env
    cd "$SITE"
    if node node_modules/astro/bin/astro.mjs dev status 2>&1 | grep -qi "running at"; then echo "already running"; urls; exit 0; fi
    node node_modules/astro/bin/astro.mjs dev --background --host 0.0.0.0 --port "$PORT" >/dev/null
    echo "started (host, Astro background server). Open one of:"; urls
    echo "edits under docs/ and docs-kit.yml reload open pages automatically"
    ;;
  host:stop)
    cd "$SITE" && node node_modules/astro/bin/astro.mjs dev stop
    ;;
  host:status)
    cd "$SITE" && node node_modules/astro/bin/astro.mjs dev status
    ;;
  host:logs)
    cd "$SITE" && exec node node_modules/astro/bin/astro.mjs dev logs --follow
    ;;
  docker:build)
    docker_run --rm -- build
    ;;
  docker:serve)
    echo "serving on:"; urls
    docker_run --rm -it -p "$PORT:$PORT" -e DOCS_PORT="$PORT" -- dev
    ;;
  docker:start)
    if docker_running; then echo "already running ($NAME)"; urls; exit 0; fi
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    docker_run -d --name "$NAME" --restart unless-stopped -p "$PORT:$PORT" -e DOCS_PORT="$PORT" -- dev >/dev/null
    echo "started $NAME (image $(image)). Open one of:"; urls
    echo "edits under docs/ and docs-kit.yml reload open pages automatically"
    ;;
  docker:stop)
    docker rm -f "$NAME" >/dev/null 2>&1 && echo "stopped $NAME" || echo "not running"
    ;;
  docker:status)
    if docker_running; then echo "running ($NAME, port $PORT)"; urls; else echo "not running ($NAME)"; fi
    ;;
  docker:logs)
    docker logs -f --tail 50 "$NAME"
    ;;
  *)
    sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
