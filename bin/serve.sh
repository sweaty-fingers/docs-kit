#!/usr/bin/env bash
# Background helper servers for the docs site's interactive parts (host Python, standard library):
#   board  sprint board save server (bin/plan_board.py): the board opened from the development preview saves
#          card moves to docs/plan/sprints.json (현황판 편집 안내 §5)
#   ask    question server for the document map (bin/docs_ask.py --serve): search + local generation model
#          (DOCS_LLM_URL) + per-sentence citation check (문서 규격 §5.6)
#
#   .docs-kit/bin/serve.sh board|ask start | stop | status | logs
#
# Both accept requests only from pages on the development preview port(s) (DOCS_DEV_PORT, default 8001), so the
# shared site stays read-only. Env: DOCS_DEV_PORT (8001), BOARD_PORT (8002), DOCS_ASK_PORT (8003), DOCS_ROOT
# (project root; default: the parent of the kit). The ask server's optional model servers (embeddings DOCS_EMBED_URL,
# generation DOCS_LLM_URL) are the project's own (e.g. a llama.cpp container); set DOCS_ASK_PRESTART to a command
# that starts them, and `start` runs it first. Logs and pids: build/serve/.
set -euo pipefail
KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="${DOCS_ROOT:-$(dirname "$KIT")}"
DEV="${DOCS_DEV_PORT:-8001}"
what="${1:-}"; cmd="${2:-status}"
case "$what" in
  board) PORT="${BOARD_PORT:-8002}"; RUNCMD=(python3 "$KIT/bin/plan_board.py" --root "$ROOT" --port "$PORT" --from-ports "$DEV")
         OPEN="http://<this PC>:$DEV/plan/board/" ;;
  ask)   PORT="${DOCS_ASK_PORT:-8003}"; RUNCMD=(python3 "$KIT/bin/docs_ask.py" --serve --root "$ROOT" --port "$PORT" --from-ports "$DEV")
         OPEN="http://<this PC>:$DEV/graph/viewer/" ;;
  *) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
RUN="$ROOT/build/serve"; PID="$RUN/$what.pid"; LOG="$RUN/$what.log"
mkdir -p "$RUN"
running() { [[ -f "$PID" ]] && kill -0 "$(cat "$PID")" 2>/dev/null; }
case "$cmd" in
  start)
    if running; then echo "$what: already running (pid $(cat "$PID"), port $PORT)"; exit 0; fi
    if [[ "$what" == ask && -n "${DOCS_ASK_PRESTART:-}" ]]; then bash -c "$DOCS_ASK_PRESTART"; fi
    (cd "$ROOT" && nohup "${RUNCMD[@]}" >>"$LOG" 2>&1 </dev/null & echo $! > "$PID")
    sleep 0.7
    if running; then echo "$what: on :$PORT (pid $(cat "$PID")). Open from the preview: $OPEN"
    else echo "$what: failed to start, see $LOG"; tail -5 "$LOG"; exit 1; fi ;;
  stop)
    if running; then kill "$(cat "$PID")"; rm -f "$PID"; echo "$what: stopped"; else rm -f "$PID"; echo "$what: not running"; fi ;;
  status)
    if running; then echo "$what: running (pid $(cat "$PID"), port $PORT)"; else echo "$what: not running (.docs-kit/bin/serve.sh $what start)"; fi ;;
  logs) tail -n 50 "$LOG" ;;
  *) echo "usage: $0 board|ask start | stop | status | logs"; exit 2 ;;
esac
