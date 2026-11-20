#!/usr/bin/env bash
# Serve or build a project's docs site (MkDocs Material + docs-kit) in Docker.
# Run from anywhere; the project is the directory that contains .docs-kit/.
#
#   .docs-kit/bin/docs.sh start     run in the background (survives logout and reboot)
#   .docs-kit/bin/docs.sh stop      stop the background server
#   .docs-kit/bin/docs.sh status    show whether it is running and the URLs to open
#   .docs-kit/bin/docs.sh logs      follow the server log (Ctrl-C to quit)
#   .docs-kit/bin/docs.sh serve     run in the foreground (Ctrl-C to stop)
#   .docs-kit/bin/docs.sh build     write the static site to build/site/ (no server)
#
# Env: DOCS_PORT (default 8000), DOCS_IMAGE (pinned MkDocs Material image),
#      DOCS_ROOT (project root; default: the parent of the kit directory)
# The server re-reads docs/, mkdocs.yml and the kit's assets on change; after
# editing the kit's hooks/*.py restart it (stop, start).
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="${DOCS_ROOT:-$(dirname "$KIT")}"
IMAGE="${DOCS_IMAGE:-squidfunk/mkdocs-material:9.5.49}"
PORT="${DOCS_PORT:-8000}"
NAME="docs-$(basename "$ROOT" | tr -c 'A-Za-z0-9_.\n-' '-')"

[[ -f "$ROOT/mkdocs.yml" ]] || { echo "ERROR: no mkdocs.yml in $ROOT (run .docs-kit/bin/init.sh first)" >&2; exit 1; }

# The container runs as the host user and only reads the project (except `build`).
RUN=(docker run --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$ROOT:/docs" -w /docs)
SERVE_ARGS=(serve --dev-addr "0.0.0.0:$PORT")

urls() {
  echo "  http://localhost:$PORT/"
  for ip in $(hostname -I 2>/dev/null); do
    case "$ip" in 172.17.*|172.18.*|*.0|*:*) ;; *) echo "  http://$ip:$PORT/" ;; esac
  done
}

running() { [[ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" == "true" ]]; }

case "${1:-}" in
  start)
    if running; then echo "already running ($NAME)"; urls; exit 0; fi
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    "${RUN[@]}" -d --name "$NAME" --restart unless-stopped -p "$PORT:$PORT" "$IMAGE" "${SERVE_ARGS[@]}" >/dev/null
    echo "started $NAME (image $IMAGE). Open one of:"; urls
    echo "edits under docs/ and mkdocs.yml reload open pages automatically"
    ;;
  stop)
    docker rm -f "$NAME" >/dev/null 2>&1 && echo "stopped $NAME" || echo "not running"
    ;;
  status)
    if running; then echo "running ($NAME, port $PORT)"; urls; else echo "not running ($NAME)"; fi
    ;;
  logs)
    docker logs -f --tail 50 "$NAME"
    ;;
  serve)
    echo "serving on:"; urls
    exec "${RUN[@]}" --rm -it -p "$PORT:$PORT" "$IMAGE" "${SERVE_ARGS[@]}"
    ;;
  build)
    exec "${RUN[@]}" --rm "$IMAGE" build
    ;;
  *)
    sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
