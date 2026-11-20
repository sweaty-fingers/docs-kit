#!/usr/bin/env python3
"""Ask the project's documents: retrieve sections (bin/docs_search.py), write an answer with a local model that may
use only those sections and must cite them, then check every sentence against what it cites. Offline: the search
index is local, the embedding and generation servers run on this PC (127.0.0.1).

    python3 .docs-kit/bin/docs_ask.py "배포 서버 포트는?"         one question in the terminal
    python3 .docs-kit/bin/docs_ask.py --serve [--port 8003]       HTTP API for the document map (graph/viewer/)

Answer pipeline
  1. search: hybrid (BM25 + embeddings, when the embedding server answers) or BM25; top K sections, at most 2 per
     document. No section -> "문서에서 확인 못 함" without calling the model.
  2. generate: the sections numbered [1]..[K]; the model is told to use only them, to end every sentence with the
     numbers it used, and to answer "문서에서 확인 못 함" when they do not say. Temperature 0.
  3. check each sentence (deterministic, like bin/docs_check.py):
       no citation, or a number not in 1..K                      -> 근거 없음 (unsupported)
       a document id, issue, path / `code`, or a number with a
       unit in the sentence that is not in the cited sections    -> 확인 못 함 (unverified), the term is named
       otherwise                                                 -> 근거 있음 (supported)
     The answer comes with the sections themselves, so a reader can see what each [n] says.
  Not caught: a sentence that cites the right section but misreads it (no checkable term). The page shows the
  evidence next to the answer for that reason.

Server: GET /api/health, GET /api/search?q=&k=, POST /api/ask {"q": ..., "k": 6}. Requests are accepted only from
pages on the development preview ports (--from-ports, 8001) like bin/plan_board.py. Generation:
DOCS_LLM_URL (http://127.0.0.1:9299, llama.cpp OpenAI API); without it the answer is the evidence only.
Standard library only (Python 3.8+).
"""
import argparse
import json
import os
import re
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import docs_search  # noqa: E402

LLM_URL = os.environ.get("DOCS_LLM_URL", "http://127.0.0.1:9299")
NO_ANSWER = "문서에서 확인 못 함"
SYSTEM = (
    "너는 이 프로젝트의 문서만 근거로 답한다. 규칙:\n"
    "1. 아래 [번호] 근거에 적힌 내용만 쓴다. 너의 지식이나 추측을 더하지 않는다.\n"
    "2. 모든 문장 끝에 그 문장의 근거 번호를 [1] 또는 [1][3]처럼 단다.\n"
    "3. 숫자, 경로, 명령, 문서 번호는 근거에 적힌 그대로 옮긴다.\n"
    f"4. 근거가 질문에 답하지 않으면 '{NO_ANSWER}' 한 문장만 쓴다.\n"
    "5. 한국어로, 3~6문장 안에서 짧게 답한다. 머리말이나 맺음말을 붙이지 않는다."
)
CITE = re.compile(r"\[(\d{1,2})\]")
UNIT = r"(?:N·m|N|mm|cm|ms|Hz|kHz|kg|g|rad|deg|°|%|s|초|MB|GB|N·s|m/s|rad/s|W|V|A|포인트|개|번)"
TERMS = [
    ("문서 번호", re.compile(r"(?<![A-Za-z0-9])(?:ADR|VR|EXP|P|MC)-\d{4}(?![0-9])")),
    ("이슈", re.compile(r"(?<![A-Za-z0-9&#])#\d{1,4}(?![0-9])")),
    ("코드", re.compile(r"`([^`]+)`")),
    ("경로", re.compile(r"(?<![\w/.-])(?:tools|docs|packages|docker|deploy|config|assets|\.docs-kit)/[\w./-]+")),
    # ASCII boundaries: Korean particles attach to numbers ("12 N이다"), and \w would count them as part of the word
    ("수치", re.compile(r"(?<![A-Za-z0-9_.])-?\d+(?:\.\d+)?\s?" + UNIT + r"(?![A-Za-z0-9_/])")),
    ("포트", re.compile(r"(?<![A-Za-z0-9_.])[89]\d{3}(?![0-9])")),
]


def sentences(text):
    """Split an answer into sentences; a citation group after the period stays with its sentence."""
    text = text.strip()
    parts = re.split(r"(?<=[.!?。])\s+(?=[^\[])|\n+", text)
    return [p.strip() for p in parts if p.strip()]


def norm(s):
    return re.sub(r"\s+", "", s).lower()


def check(answer, evidence):
    """-> [{"text", "cites", "verdict", "missing"}] and a summary."""
    out = []
    for s in sentences(answer):
        cites = sorted({int(n) for n in CITE.findall(s)})
        body = CITE.sub("", s).strip()
        if norm(body).startswith(norm(NO_ANSWER)):
            out.append({"text": s, "cites": cites, "verdict": "none", "missing": []})
            continue
        if not cites:
            out.append({"text": s, "cites": [], "verdict": "unsupported", "missing": [], "why": "근거 번호 없음"})
            continue
        bad = [n for n in cites if not 1 <= n <= len(evidence)]
        if bad:
            out.append({"text": s, "cites": cites, "verdict": "unsupported", "missing": [],
                        "why": "없는 근거 번호 " + ", ".join(f"[{n}]" for n in bad)})
            continue
        raw = " ".join(evidence[n - 1]["text"] + " " + evidence[n - 1]["path"] for n in cites)
        src = norm(raw)
        missing = []
        for kind, rx in TERMS:
            for m in rx.finditer(re.sub(r"\*\*", "", body)):
                term = (m.group(1) if rx.groups else m.group(0)).strip()
                if kind in ("수치", "포트"):          # a number must stand on its own in the evidence (8 N is not 18 N)
                    num = re.match(r"-?\d+(?:\.\d+)?", term).group(0)
                    ok = re.search(r"(?<![\d.])" + re.escape(num) + r"(?![\d])", raw) is not None
                else:
                    ok = norm(term) in src
                if not ok:
                    missing.append(f"{kind} {term}")
        out.append({"text": s, "cites": cites, "verdict": "unverified" if missing else "supported", "missing": missing})
    counts = {k: sum(1 for x in out if x["verdict"] == k) for k in ("supported", "unverified", "unsupported", "none")}
    return out, counts


_LLM_LOCK = threading.Lock()          # one question at a time on the model (it has one slot); others wait


def llm(messages, max_tokens=500):
    with _LLM_LOCK:
        return _llm(messages, max_tokens)


def _llm(messages, max_tokens=500):
    body = json.dumps({"messages": messages, "max_tokens": max_tokens, "temperature": 0, "stream": False,
                       "chat_template_kwargs": {"enable_thinking": False}}).encode("utf-8")
    req = urllib.request.Request(LLM_URL.rstrip("/") + "/v1/chat/completions", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        j = json.load(r)
    text = j["choices"][0]["message"].get("content") or ""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
    return text, j.get("model", ""), j.get("timings", {})


def llm_ok():
    try:
        with urllib.request.urlopen(LLM_URL.rstrip("/") + "/health", timeout=1) as r:
            return r.status == 200
    except OSError:
        return False


class Asker:
    def __init__(self, root):
        self.root = root
        self.emb = docs_search.Embedder(docs_search.EMBED_URL, root)

    def idx(self):
        return docs_search.load(self.root)            # cached; rebuilt when a document changes

    def search(self, q, k=8):
        idx = self.idx()
        if not self.emb.ok():
            self.emb = docs_search.Embedder(docs_search.EMBED_URL, self.root)
        mode = "auto" if self.emb.ok() else "bm25"
        info = {}
        hits = docs_search.search(idx, q, k=k, mode=mode, root=self.root, emb=self.emb if mode == "auto" else None,
                                  build=False, info=info)
        mode = "bm25" if (mode == "bm25" or info.get("fallback")) else "hybrid"
        self.fallback = info.get("fallback", "")
        secs = {(s["path"], s["start"]): s for s in idx["secs"]}
        for h in hits:
            h["text"] = secs[(h["path"], h["lines"][0])]["text"]
        return hits, mode

    def ask(self, q, k=6, generate=True):
        t0 = time.time()
        hits, mode = self.search(q, k)
        res = {"q": q, "mode": mode, "fallback": getattr(self, "fallback", ""), "evidence": [{k_: h[k_] for k_ in ("path", "lines", "id", "title", "head", "layer",
                                                                        "status", "superseded_by", "via", "snippet", "text")}
                                                  for h in hits]}
        if not hits:
            res.update(answer=NO_ANSWER, sentences=[{"text": NO_ANSWER, "cites": [], "verdict": "none", "missing": []}],
                       counts={"none": 1}, model="", generated=False)
        elif generate and llm_ok():
            ev = "\n\n".join(f"[{i + 1}] {h['path']}:{h['lines'][0]} {h['head'] or h['title']}"
                             f"{' (대체됨: ' + h['superseded_by'] + ')' if h['superseded_by'] else ''}\n{h['text'][:1800]}"
                             for i, h in enumerate(hits))
            text, model, tm = llm([{"role": "system", "content": SYSTEM},
                                   {"role": "user", "content": f"근거:\n{ev}\n\n질문: {q}"}])
            sents, counts = check(text, res["evidence"])
            res.update(answer=text, sentences=sents, counts=counts, model=model, generated=True,
                       gen_ms=round(tm.get("prompt_ms", 0) + tm.get("predicted_ms", 0)))
        else:
            res.update(answer="", sentences=[], counts={}, model="", generated=False,
                       note="생성 서버가 꺼져 있어 근거만 보입니다 (" + docs_search.start_hint(self.root, "llm_start", "생성 서버: DOCS_LLM_URL") + ")")
        res["ms"] = round(1000 * (time.time() - t0))
        return res


def serve(root, port, from_ports, bind):
    asker = Asker(root)

    class H(BaseHTTPRequestHandler):
        def _origin_ok(self):
            o = self.headers.get("Origin")
            return bool(o) and str(urlparse(o).port) in from_ports

        def _send(self, code, obj):
            b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            if self._origin_ok():
                self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
                self.send_header("Vary", "Origin")
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def do_OPTIONS(self):
            if not self._origin_ok():
                return self._send(403, {"error": "origin not allowed"})
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
            self.send_header("Access-Control-Allow-Methods", "GET, POST")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

        def do_GET(self):
            u = urlparse(self.path)
            if not self._origin_ok() and u.path != "/api/health":
                return self._send(403, {"error": "only pages on the development preview (ports %s)" % ", ".join(sorted(from_ports))})
            if u.path == "/api/health":
                return self._send(200, {"ok": True, "embed": asker.emb.ok() or docs_search.Embedder(docs_search.EMBED_URL).ok(),
                                        "llm": llm_ok()})
            if u.path == "/api/search":
                qs = parse_qs(u.query)
                q = (qs.get("q") or [""])[0].strip()
                if not q:
                    return self._send(400, {"error": "q"})
                hits, mode = asker.search(q, int((qs.get("k") or ["10"])[0]))
                return self._send(200, {"q": q, "mode": mode, "hits": hits})
            return self._send(404, {"error": "not found"})

        def do_POST(self):
            if urlparse(self.path).path != "/api/ask":
                return self._send(404, {"error": "not found"})
            if not self._origin_ok():
                return self._send(403, {"error": "only pages on the development preview (ports %s)" % ", ".join(sorted(from_ports))})
            n = int(self.headers.get("Content-Length") or 0)
            if not 0 < n < 20000:
                return self._send(413, {"error": "body"})
            try:
                d = json.loads(self.rfile.read(n).decode("utf-8"))
                q = str(d.get("q", "")).strip()[:500]
            except ValueError:
                return self._send(400, {"error": "JSON"})
            if not q:
                return self._send(400, {"error": "q"})
            try:
                return self._send(200, asker.ask(q, max(3, min(10, int(d.get("k", 6))))))
            except OSError as e:
                sys.stderr.write(f"{time.strftime('%H:%M:%S')} ask failed: {e!r}\n"); sys.stderr.flush()
                return self._send(502, {"error": f"model server: {e}"})

        def log_message(self, fmt, *args):
            sys.stderr.write("%s %s %s\n" % (time.strftime("%H:%M:%S"), self.headers.get("Origin", "-"), fmt % args))
            sys.stderr.flush()                         # Python 3.8 buffers stderr when it is a file

    srv = ThreadingHTTPServer((bind, port), H)
    print(f"docs ask server on {bind}:{port}, root {root}, pages on ports {', '.join(sorted(from_ports))}; "
          f"embeddings {docs_search.EMBED_URL}, generation {LLM_URL}", flush=True)
    srv.serve_forever()


def main():
    ap = argparse.ArgumentParser(description="Ask the project's documents (local, cited, checked).")
    ap.add_argument("question", nargs="*")
    ap.add_argument("--root", default=os.getcwd())
    ap.add_argument("-k", type=int, default=6)
    ap.add_argument("--serve", action="store_true")
    ap.add_argument("--port", type=int, default=int(os.environ.get("DOCS_ASK_PORT", "8003")))
    ap.add_argument("--bind", default=os.environ.get("DOCS_ASK_BIND", "0.0.0.0"))
    ap.add_argument("--from-ports", default=os.environ.get("DOCS_PORT", "8001"))
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    root = os.path.abspath(a.root)
    if a.serve:
        serve(root, a.port, {p.strip() for p in a.from_ports.split(",") if p.strip()}, a.bind)
        return 0
    if not a.question:
        ap.error("a question, or --serve")
    r = Asker(root).ask(" ".join(a.question), a.k)
    if a.json:
        print(json.dumps(r, ensure_ascii=False, indent=1))
        return 0
    mark = {"supported": "✓", "unverified": "?", "unsupported": "✗", "none": "·"}
    print(f"[{r['mode']}{', ' + r['model'] if r.get('model') else ''}, {r['ms']} ms]")
    for s in r["sentences"]:
        extra = (" (" + ", ".join(s["missing"]) + ")") if s.get("missing") else (" (" + s["why"] + ")" if s.get("why") else "")
        print(f" {mark[s['verdict']]} {s['text']}{extra}")
    if r.get("note"):
        print(" " + r["note"])
    print("근거:")
    for i, e in enumerate(r["evidence"], 1):
        print(f" [{i}] {e['path']}:{e['lines'][0]}-{e['lines'][1]} {e['head'] or e['title']} ({e['via']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
