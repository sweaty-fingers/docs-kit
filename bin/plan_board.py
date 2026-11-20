#!/usr/bin/env python3
"""Save server for the sprint board (docs-kit plan/board/): writes <project>/docs/plan/sprints.json.

The docs site is static, so the board cannot write files by itself. Opened from the development preview (8001), it
POSTs every change here; this server checks the data and writes sprints.json (pretty JSON, which is also YAML), and
the preview rebuilds. Only requests whose Origin is one of the preview ports are accepted (the shared site at 8000 is
read-only). Before each write the old file is copied to build/plan/sprints-backup/ (the last 50 are kept).

    python3 .docs-kit/bin/plan_board.py --root <project> [--port 8002] [--from-ports 8001]
    (or in the background: .docs-kit/bin/serve.sh board start | stop | status | logs)

Env: BOARD_PORT (8002), DOCS_PORT (8001, the preview the board must come from). Standard library only (Python 3.8+),
so it runs on the host without the docs image. Guide: plan/guide.md §5.
"""
import argparse
import datetime as dt
import json
import os
import re
import shutil
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.getcwd()
FILE = BACKUP = ""
COLS = {"todo", "doing", "review", "done"}
STATES = {"planned", "active", "closed"}
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MAX_BODY = 1 << 20


def check(d):
    """Return an error message, or None when the data is a valid sprints file."""
    if not isinstance(d, dict) or not isinstance(d.get("sprints"), list):
        return "need an object with a 'sprints' list"
    ids, active, prev_end = set(), 0, ""
    for s in d["sprints"]:
        if not isinstance(s, dict):
            return "a sprint is not an object"
        sid = s.get("id")
        if not isinstance(sid, str) or not sid or sid in ids:
            return "sprint id missing or duplicated: %r" % sid
        ids.add(sid)
        a, b = s.get("start"), s.get("end")
        if not (isinstance(a, str) and isinstance(b, str) and DATE.match(a) and DATE.match(b) and a <= b):
            return "%s: start / end must be YYYY-MM-DD, start <= end" % sid
        if prev_end and a <= prev_end:
            return "%s starts before the previous sprint ends" % sid
        prev_end = b
        if s.get("state") not in STATES:
            return "%s: state must be planned, active or closed" % sid
        active += s["state"] == "active"
        items = s.get("items") or {}
        if not isinstance(items, dict) or any(not isinstance(k, str) or v not in COLS for k, v in items.items()):
            return "%s: items must map an item id to todo, doing, review or done" % sid
        for key in ("blocked", "retro"):
            v = s.get(key) or {}
            if not isinstance(v, dict) or any(not isinstance(x, str) for x in v.values()):
                return "%s: %s must map to text" % (sid, key)
        if not isinstance(s.get("carried") or [], list) or not isinstance(s.get("goal") or "", str):
            return "%s: carried must be a list, goal text" % sid
    if active > 1:
        return "at most one active sprint"
    return None


def write(d):
    os.makedirs(BACKUP, exist_ok=True)
    if os.path.exists(FILE):
        shutil.copy2(FILE, os.path.join(BACKUP, "sprints-%s.json" % dt.datetime.now().strftime("%Y%m%d-%H%M%S-%f")))
        old = sorted(os.listdir(BACKUP))
        for f in old[:-50]:
            os.remove(os.path.join(BACKUP, f))
    keep = {k: d[k] for k in ("cadence_days", "wip_limit", "save") if k in d}
    order = ["id", "start", "end", "state", "goal", "items", "blocked", "carried", "retro", "closed_at", "note"]
    sprints = [{k: s[k] for k in order if k in s and s[k] not in (None, "", {}, [])} for s in d["sprints"]]
    for s, src in zip(sprints, d["sprints"]):
        s.setdefault("items", {})
        for k in src:
            if k not in order:
                s[k] = src[k]
    tmp = FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(dict(keep, sprints=sprints), f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, FILE)


class Handler(BaseHTTPRequestHandler):
    from_ports = {"8001"}

    def _origin_ok(self):
        o = self.headers.get("Origin")
        if not o:
            return False
        u = urlparse(o)
        return str(u.port) in self.from_ports

    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        if self._origin_ok():
            self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
            self.send_header("Vary", "Origin")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        if not self._origin_ok():
            return self._send(403, {"error": "origin not allowed"})
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
        self.send_header("Access-Control-Allow-Methods", "GET, POST")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self):
        if self.path.split("?")[0] != "/api/sprints":
            return self._send(404, {"error": "not found"})
        if not os.path.exists(FILE):
            return self._send(200, {"sprints": []})
        with open(FILE, encoding="utf-8") as f:
            return self._send(200, json.load(f))

    def do_POST(self):
        if self.path.split("?")[0] != "/api/sprints":
            return self._send(404, {"error": "not found"})
        if not self._origin_ok():
            return self._send(403, {"error": "only the development preview may save (ports %s)" % ", ".join(sorted(self.from_ports))})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            return self._send(413, {"error": "body too large or empty"})
        try:
            d = json.loads(self.rfile.read(n).decode("utf-8"))
        except ValueError as e:
            return self._send(400, {"error": "not JSON: %s" % e})
        err = check(d)
        if err:
            return self._send(400, {"error": err})
        write(d)
        self.log_message("saved %d sprints", len(d["sprints"]))
        return self._send(200, {"ok": True})


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default=os.getcwd(), help="project root (holds docs/plan/)")
    ap.add_argument("--port", type=int, default=int(os.environ.get("BOARD_PORT", "8002")))
    ap.add_argument("--bind", default=os.environ.get("BOARD_BIND", "0.0.0.0"))
    ap.add_argument("--from-ports", default=os.environ.get("DOCS_PORT", "8001"),
                    help="comma separated ports of pages allowed to save (the development preview)")
    a = ap.parse_args()
    global ROOT, FILE, BACKUP
    ROOT = os.path.abspath(a.root)
    FILE = os.path.join(ROOT, "docs", "plan", "sprints.json")
    BACKUP = os.path.join(ROOT, "build", "plan", "sprints-backup")
    if not os.path.isdir(os.path.dirname(FILE)):
        print("no docs/plan/ under %s" % ROOT, file=sys.stderr)
        return 2
    Handler.from_ports = {p.strip() for p in a.from_ports.split(",") if p.strip()}
    srv = ThreadingHTTPServer((a.bind, a.port), Handler)
    print("board save server on %s:%d, writes %s, accepts pages on ports %s"
          % (a.bind, a.port, os.path.relpath(FILE, ROOT), ", ".join(sorted(Handler.from_ports))), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
