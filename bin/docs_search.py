#!/usr/bin/env python3
"""Search a project's documents by section (retrieval for agents and people: find the source before you state a fact).

    python3 .docs-kit/bin/docs_search.py "배포 서버 포트는 무엇인가" [-k 8] [--json] [--root .] [--all]

Corpus: docs/**/*.md (not assets/) and the root AGENTS.md / README.md, split at headings into sections, each with its
path, heading trail and line range. Ranking: BM25 (k1 1.2, b 0.75) over words and, for Hangul, character bigrams
(no morphological analyser is needed and particles do not break matches); a title / heading field weighs double;
exact document ids (ADR-0012, VR-0004, #61, G7) in the query are matched as whole tokens and boosted. Each hit says
the document's layer (정본 / 운영 / 발행물 / 지식) and status, and a superseded record (front matter `supersedes`
of a newer one) is marked "대체됨 → <newer>" and ranked lower, so a stale result is not quoted as current; reports
and overviews (발행물) rank a little lower than the canonical documents they quote. A query that matches less than half
of its own words in a section gets nothing from that section: "찾은 곳 없음" is an answer, not a failure.

Standard library only (Python 3.8+), so it runs on the host. The index is cached in build/rag/index.json and rebuilt
when a file changes. Used by bin/docs_check.py (retrieval evaluation on the grounding page) and by agents (AGENTS.md).
"""
import argparse
import hashlib
import json
import math
import time
import os
import re
import sys
import urllib.request
from collections import Counter, defaultdict

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ID_RE = re.compile(r"(?<![A-Za-z0-9])(?:ADR|VR|EXP|P|MC)-\d{4}(?![0-9])|#\d{1,4}(?![0-9])|(?<![A-Za-z0-9])[GRA]\d{1,2}(?![0-9A-Za-z])")
WORD_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_.\-]*[A-Za-z0-9_]|[A-Za-z]|\d+(?:\.\d+)?|[가-힣]+")
HEAD_RE = re.compile(r"^(#{1,4})\s+(.*)$")
PARTICLES = ("에서는", "으로는", "에게서", "이라는", "에서", "으로", "에게", "까지", "부터", "보다", "처럼", "이다", "하는",
             "하고", "에는", "은", "는", "이", "가", "을", "를", "에", "의", "와", "과", "도", "로", "만")
ENDINGS = ("하려면", "하는가", "하는지", "합니까", "되는가", "되는지", "인가요", "할까", "하나요", "하나", "인가", "인지", "되나",
           "한다", "된다", "해야", "하고", "했나", "했다", "하면")
STOP = {"the", "a", "an", "of", "to", "and", "or", "in", "is", "for", "on", "with", "합니다", "있습니다", "입니다",
        "그리고", "또는", "무엇", "어떻게", "얼마", "얼마인가", "인가", "무엇인가", "왜", "어디", "언제"}
CANON = ("adr", "records", "experiments", "arc42", "models")
PUBL = ("publications", "weekly")
KNOW = ("background", "glossary")


def layer(path):
    top = path.split("/")[1] if path.startswith("docs/") and "/" in path[5:] else ""
    if top in CANON:
        return "정본"
    if top in PUBL:
        return "발행물"
    if top in KNOW:
        return "지식"
    return "운영"


def stem(w):
    """Strip one verbal ending (마운트하나 -> 마운트) or one particle (마운트는 -> 마운트)."""
    for e in ENDINGS:
        if len(w) > len(e) + 1 and w.endswith(e):
            return w[: -len(e)]
    for p in PARTICLES:
        if len(w) > len(p) + 1 and w.endswith(p):
            return w[: -len(p)]
    return w


def tokens(text):
    """Lower-case words; Hangul runs give the stem (endings and particles stripped) and character bigrams."""
    out = []
    for m in WORD_RE.finditer(text):
        w = m.group(0)
        if "가" <= w[0] <= "힣":
            w = stem(w)
            if w in STOP:
                continue
            out.append(w)
            if len(w) > 2:
                out += [w[i:i + 2] for i in range(len(w) - 1)]
        else:
            w = w.lower()
            if w in STOP:
                continue
            out.append(w)
            if "_" in w or "." in w or "-" in w:      # block_lead_rad -> block, lead, rad too
                out += [p for p in re.split(r"[_.\-]", w) if len(p) > 1]
    return out


def front_matter(lines):
    meta, end = {}, 0
    if lines and lines[0].strip() == "---":
        for i in range(1, min(len(lines), 60)):
            if lines[i].strip() == "---":
                end = i + 1
                break
            m = re.match(r"^([A-Za-z_]+):\s*(.*)$", lines[i])
            if m:
                meta[m.group(1)] = m.group(2).strip()
    return meta, end


def doc_id(path, meta):
    name = os.path.basename(path)
    for kind, sub in (("ADR", "docs/adr/"), ("VR", "docs/records/"), ("EXP", "docs/experiments/"), ("P", "docs/publications/")):
        m = re.match(r"^(\d{4})-", name)
        if path.startswith(sub) and m:
            return f"{kind}-{m.group(1)}"
    m = re.match(r"^([gra])(\d+)_", name)
    if m and path.startswith(("docs/guides/", "docs/reference/", "docs/arc42/")):
        return f"{m.group(1).upper()}{int(m.group(2))}"
    return ""


def files(root):
    out = []
    for base in ("docs",):
        for dp, dn, fn in os.walk(os.path.join(root, base)):
            dn[:] = sorted(d for d in dn if d not in ("assets", "figures") and not d.startswith("."))
            for f in sorted(fn):
                if f.endswith(".md"):
                    out.append(os.path.relpath(os.path.join(dp, f), root).replace(os.sep, "/"))
    for f in ("AGENTS.md", "README.md"):
        if os.path.exists(os.path.join(root, f)):
            out.append(f)
    return out


def sections(root, path):
    """Split a markdown file at headings (outside code fences) -> list of section dicts."""
    with open(os.path.join(root, path), encoding="utf-8") as f:
        lines = f.read().split("\n")
    meta, start = front_matter(lines)
    title, trail, cur, out, fence = "", [], None, [], False

    def close(end):
        if cur and any(x.strip() for x in cur["body"]):
            out.append(dict(cur, end=end, text="\n".join(cur["body"])))

    cur = {"path": path, "head": "", "start": start + 1, "body": []}
    for i in range(start, len(lines)):
        ln = lines[i]
        if ln.lstrip().startswith(("```", "~~~")):
            fence = not fence
        m = None if fence else HEAD_RE.match(ln)
        if m:
            close(i)
            lv, h = len(m.group(1)), re.sub(r"\{#.*\}$", "", m.group(2)).strip()
            if lv == 1 and not title:
                title = h
            trail = trail[: lv - 1] + [h]
            cur = {"path": path, "head": " › ".join(trail[1:] if len(trail) > 1 else trail), "start": i + 1, "body": [ln]}
        else:
            cur["body"].append(ln)
    close(len(lines))
    for s in out:
        s["title"] = title or meta.get("title", "") or path
        s.pop("body", None)
    return meta, out


def build(root):
    docs, secs = {}, []
    for p in files(root):
        meta, ss = sections(root, p)
        docs[p] = {"id": doc_id(p, meta), "status": meta.get("status", "") or meta.get("result", ""), "supersedes": meta.get("supersedes", ""),
                   "layer": layer(p), "mtime": os.path.getmtime(os.path.join(root, p)), "title": ss[0]["title"] if ss else p}
        secs += ss
    # superseded-by map from front matter `supersedes: VR-0012` (or a list)
    by_id = {d["id"]: p for p, d in docs.items() if d["id"]}
    for p, d in docs.items():
        kind = d["id"].split("-")[0] if "-" in d["id"] else ""
        olds = re.findall(r"(?:ADR|VR|EXP|P)-\d{4}", d["supersedes"])
        olds += [f"{kind}-{int(n):04d}" for n in re.findall(r"(?<![-\d])(\d{1,4})(?![\d])", re.sub(r"(?:ADR|VR|EXP|P)-\d{4}", "", d["supersedes"]))] if kind else []
        for old in olds:
            if old in by_id:
                docs[by_id[old]]["superseded_by"] = d["id"]
    for s in secs:
        s["tok"] = tokens(s["text"])
        s["htok"] = tokens(s["title"] + " " + s["head"])
    df = Counter()
    for s in secs:
        df.update(set(s["tok"]) | set(s["htok"]))
    avg = sum(len(s["tok"]) for s in secs) / max(1, len(secs))
    return {"docs": docs, "secs": secs, "df": dict(df), "avg": avg, "n": len(secs)}


def load(root, cache=True):
    cpath = os.path.join(root, "build", "rag", "index.json")
    stamp = {p: os.path.getmtime(os.path.join(root, p)) for p in files(root)}
    if cache and os.path.exists(cpath):
        try:
            with open(cpath, encoding="utf-8") as f:
                idx = json.load(f)
            if idx.get("stamp") == stamp and idx.get("version") == 5:
                return idx
        except (ValueError, OSError):
            pass
    idx = build(root)
    idx["stamp"], idx["version"] = stamp, 5
    if cache:
        try:
            os.makedirs(os.path.dirname(cpath), exist_ok=True)
            with open(cpath, "w", encoding="utf-8") as f:
                json.dump(idx, f, ensure_ascii=False)
        except OSError:
            pass
    return idx


def bm25(idx, query, include_superseded=True):
    """BM25 ranking: [(score, section)] best first, weak partial matches dropped."""
    q = tokens(query)
    ids = [m.group(0) for m in ID_RE.finditer(query)]
    n, avg, df = idx["n"], idx["avg"], idx["df"]
    qc = Counter(q)
    main = set(main_words(query))
    scored = []
    for s in idx["secs"]:
        tf, htf = Counter(s["tok"]), Counter(s["htok"])
        dl = len(s["tok"]) or 1
        score = 0.0
        for t, qn in qc.items():
            if t not in df:
                continue
            idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
            f = tf.get(t, 0) + 2 * htf.get(t, 0)
            if f:
                score += qn * idf * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * dl / avg))
        d = idx["docs"][s["path"]]
        named = False
        for i in ids:
            if i == d["id"]:
                score += 12.0
                named = True
            elif re.search(r"(?<![A-Za-z0-9-])" + re.escape(i) + r"(?![0-9A-Za-z])", s["text"]):
                score += 2.0
                named = True
        if score <= 0:
            continue
        # coverage: share of the query's words (not bigrams) found here; weak partial matches are not evidence
        words = [t for t in set(q) if t in main]
        cov = sum(1 for t in words if t in tf or t in htf) / max(1, len(words))
        if not named and cov < 0.5:
            continue
        score *= prior(d, ids, include_superseded)
        if score > 0:
            scored.append((score, s))
    scored.sort(key=lambda x: -x[0])
    return scored


def prior(d, ids, include_superseded=True):
    """Reports and overviews quote the canonical documents (prefer the source); superseded records rank lower."""
    w = 0.85 if d["layer"] == "발행물" else 1.0
    if d.get("superseded_by") and d["id"] not in ids:
        w = 0.0 if not include_superseded else w * 0.6
    return w


# ---------------- dense retrieval through a local embedding server (optional) ----------------
EMBED_URL = os.environ.get("DOCS_EMBED_URL", "http://127.0.0.1:9298")
DENSE_MIN = float(os.environ.get("DOCS_DENSE_MIN", "0.0"))     # set per model by the evaluation (see --calibrate)
RRF_K = 60
# Query-side instruction for instruction-tuned embedding models (Qwen3-Embedding). A project may name its domain with
# DOCS_EMBED_INSTRUCT or docs/quality/config.json "embed_instruct" (e.g. "Given a question about an <area> project, retrieve ...").
EMBED_INSTRUCT = "Given a question about a technical project, retrieve the document sections that answer it"


def dense_min(root, emb):
    """Similarity a section found only by the embeddings must reach (per model: docs/quality/config.json
    "dense_min": {"<model key>": 0.55}; set from the answerable vs out-of-scope questions in a VR). DOCS_DENSE_MIN wins."""
    if os.environ.get("DOCS_DENSE_MIN"):
        return float(os.environ["DOCS_DENSE_MIN"])
    try:
        c = json.load(open(os.path.join(root, "docs", "quality", "config.json"), encoding="utf-8"))
    except (OSError, ValueError):
        return 0.0
    key = os.path.basename(str(getattr(emb, "model", "")).rstrip("/"))
    return float((c.get("dense_min") or {}).get(key, 0.0))


def dense_weight():
    """Weight of the dense ranking in the fusion (BM25 weighs 1). Technical documents full of ids and commands favour
    the lexical side; the value is set by the project's evaluation (a VR) and can be overridden with DOCS_DENSE_WEIGHT."""
    return float(os.environ.get("DOCS_DENSE_WEIGHT", "1.0"))


def start_hint(root, key, default):
    """How to start a local model server, for messages: docs/quality/config.json "embed_start" / "llm_start"."""
    try:
        c = json.load(open(os.path.join(root or ".", "docs", "quality", "config.json"), encoding="utf-8"))
        return str(c.get(key) or default)
    except (OSError, ValueError):
        return default


EMBED_HINT = "the project's embedding server, docs/quality/config.json embed_start"


class Embedder:
    """Client of a text-embeddings-inference server (POST /embed). Offline: the server runs on this PC."""

    def __init__(self, url, root=None):
        self.url = url.rstrip("/")
        # domain instruction: DOCS_EMBED_INSTRUCT, else docs/quality/config.json "embed_instruct", else generic
        self.instruct = os.environ.get("DOCS_EMBED_INSTRUCT") or start_hint(root, "embed_instruct", EMBED_INSTRUCT)
        self.info = self._get("/info", timeout=0.5)
        self.model = (self.info or {}).get("model_id", "")

    def _get(self, path, timeout=5):
        try:
            with urllib.request.urlopen(self.url + path, timeout=timeout) as r:
                return json.load(r)
        except (OSError, ValueError):
            return None

    def ok(self):
        return bool(self.info)

    def embed(self, texts, batch=32):
        out = []
        for i in range(0, len(texts), batch):
            body = json.dumps({"inputs": texts[i:i + batch], "normalize": True, "truncate": True}).encode("utf-8")
            req = urllib.request.Request(self.url + "/embed", data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=300) as r:
                out += json.load(r)
        return out

    def query_text(self, q):
        # Qwen3-Embedding wants an instruction on the query side only (model card)
        pooling = ((self.info or {}).get("model_type") or {}).get("embedding", {}).get("pooling", "")
        if "qwen" in self.model.lower() or pooling == "last_token":
            return "Instruct: " + self.instruct + "\nQuery:" + q
        return q


def section_text(s):
    return (s["title"] + " / " + s["head"] + "\n" + s["text"])[:2000]


def section_key(s):
    return hashlib.sha1((s["path"] + "\0" + section_text(s)).encode("utf-8")).hexdigest()[:16]


class NotReady(RuntimeError):
    """The vector index for this model is incomplete (an interactive search does not build it)."""


def vectors(root, idx, emb, build=True, max_new=0):
    """Section vectors for this model, cached in build/rag/vectors-<model>.json; only new or changed sections are sent.
    build=False (interactive search): never computes (a CPU server takes tens of seconds per long section, and
    concurrent questions would queue behind each other); missing sections get None and are found by BM25 only.
    NotReady when most of the index is missing (the model was just switched): docs_search.py --build-vectors."""
    name = re.sub(r"[^A-Za-z0-9_.-]+", "_", emb.model or "model")[-80:]
    cpath = os.path.join(root, "build", "rag", f"vectors-{name}.json")
    cache = {}
    if os.path.exists(cpath):
        try:
            cache = json.load(open(cpath, encoding="utf-8"))
        except ValueError:
            cache = {}
    keys = [section_key(s) for s in idx["secs"]]
    todo = [(k, s) for k, s in zip(keys, idx["secs"]) if k not in cache]
    if not build:
        if len(todo) > len(keys) // 2:
            raise NotReady(f"{len(todo)}/{len(keys)} sections without vectors for {emb.model}: "
                           "python3 .docs-kit/bin/docs_search.py --build-vectors")
        return [cache.get(k) for k in keys]
    # similar lengths together (less padding inside a batch, much faster on CPU), saved every few batches so an
    # interrupted first run continues where it stopped
    todo.sort(key=lambda ks: len(section_text(ks[1])))
    live = set(keys)

    def save():
        os.makedirs(os.path.dirname(cpath), exist_ok=True)
        with open(cpath + ".tmp", "w", encoding="utf-8") as f:
            json.dump({k: v for k, v in cache.items() if k in live}, f)
        os.replace(cpath + ".tmp", cpath)

    step = 16
    for i in range(0, len(todo), step):
        part = todo[i:i + step]
        for (k, _), v in zip(part, emb.embed([section_text(s) for _, s in part], batch=step)):
            cache[k] = [round(x, 5) for x in v]
        if (i // step) % 8 == 7:
            save()
    if todo or len(cache) != len(live):
        save()
    return [cache[k] for k in keys]


def dense(root, idx, query, emb, include_superseded=True, build=True):
    """Dense ranking: [(cosine * prior, section)] best first."""
    vs = vectors(root, idx, emb, build=build)
    qv = emb.embed([emb.query_text(query)])[0]
    ids = [m.group(0) for m in ID_RE.finditer(query)]
    out = []
    for s, v in zip(idx["secs"], vs):
        if v is None:                                  # not embedded yet (edited since the last --build-vectors)
            continue
        sim = sum(a * b for a, b in zip(qv, v))
        w = prior(idx["docs"][s["path"]], ids, include_superseded)
        if w > 0:
            out.append((sim * w, s))
    out.sort(key=lambda x: -x[0])
    return out


def search(idx, query, k=8, include_superseded=True, mode="auto", root=None, emb=None, build=True, info=None):
    """mode: bm25 | hybrid | dense | auto (hybrid when the embedding server answers, else bm25).
    Each hit says how it was found (via: bm25 / dense / both)."""
    q = tokens(query)
    lex = bm25(idx, query, include_superseded)
    if mode != "bm25":
        emb = emb or Embedder(EMBED_URL, root)
        if not emb.ok():
            if mode in ("hybrid", "dense"):
                raise RuntimeError(f"embedding server not reachable at {EMBED_URL} ({start_hint(root, 'embed_start', EMBED_HINT)})")
            mode = "bm25"
    if mode != "bm25":
        try:
            den = dense(root or ROOT_GUESS, idx, query, emb, include_superseded, build=build)
        except NotReady as e:
            if mode != "auto" and build:
                raise
            if info is not None:
                info["fallback"] = str(e)
            mode, den = "bm25", []
    if mode == "bm25":
        ranked = [(sc, s, "bm25") for sc, s in lex]
    else:
        dmin = dense_min(root or ROOT_GUESS, emb)
        if mode == "dense":
            ranked = [(sc, s, "dense") for sc, s in den if sc >= dmin]
        else:
            # Reciprocal rank fusion of the two rankings (no score scales to tune). A section only the dense side
            # found must clear DENSE_MIN, so "찾은 곳 없음" still happens for questions the documents do not answer.
            fused, via = defaultdict(float), {}
            for r, (sc, s) in enumerate(lex[:50]):
                key = (s["path"], s["start"])
                fused[key] += 1.0 / (RRF_K + r + 1)
                via[key] = ("bm25", s)
            w = dense_weight()
            for r, (sc, s) in enumerate(den[:50]):
                key = (s["path"], s["start"])
                if key not in via and sc < dmin:
                    continue
                fused[key] += w / (RRF_K + r + 1)
                via[key] = ("both" if key in via else "dense", s)
            ranked = sorted(((v, via[key][1], via[key][0]) for key, v in fused.items()), key=lambda x: -x[0])
    out, seen = [], defaultdict(int)
    for score, s, how in ranked:
        if seen[s["path"]] >= 2:                 # at most 2 sections per document, so k hits cover several sources
            continue
        seen[s["path"]] += 1
        d = idx["docs"][s["path"]]
        out.append({"score": round(score, 4), "path": s["path"], "lines": [s["start"], s["end"]], "id": d["id"],
                    "title": s["title"], "head": s["head"], "layer": d["layer"], "status": d["status"],
                    "superseded_by": d.get("superseded_by", ""), "via": how, "snippet": snippet(s["text"], q)})
        if len(out) >= k:
            break
    return out


ROOT_GUESS = os.getcwd()


def main_words(text):
    """The query's own words (stems, ids), not the bigrams added for matching."""
    out = []
    for m in WORD_RE.finditer(text):
        w = m.group(0)
        w = stem(w) if "가" <= w[0] <= "힣" else w.lower()
        if w not in STOP:
            out.append(w)
    return out


def snippet(text, q, width=220):
    body = [ln for ln in text.split("\n") if ln.strip() and not ln.startswith("#")]
    best, bi = -1, 0
    qs = set(q)
    for i, ln in enumerate(body):
        sc = len(qs & set(tokens(ln)))
        if sc > best:
            best, bi = sc, i
    s = " ".join(x.strip() for x in body[bi: bi + 3])
    return (s[:width] + "…") if len(s) > width else s


def main():
    ap = argparse.ArgumentParser(description="Search the project's documents by section (BM25, Korean bigrams).")
    ap.add_argument("query", nargs="*")
    ap.add_argument("-k", type=int, default=8)
    ap.add_argument("--root", default=os.getcwd())
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--current", action="store_true", help="leave out superseded records")
    ap.add_argument("--build-vectors", action="store_true",
                    help="compute the section vectors for the running embedding server's model (first run: minutes)")
    ap.add_argument("--mode", choices=["auto", "bm25", "hybrid", "dense"], default="auto",
                    help="auto: hybrid when the local embedding server answers (DOCS_EMBED_URL), else bm25")
    a = ap.parse_args()
    root = os.path.abspath(a.root)
    if not os.path.isdir(os.path.join(root, "docs")):
        print(f"no docs/ under {root}", file=sys.stderr)
        return 2
    if a.build_vectors:
        emb = Embedder(EMBED_URL, root)
        if not emb.ok():
            print(f"embedding server not reachable at {EMBED_URL} ({start_hint(root, 'embed_start', EMBED_HINT)})", file=sys.stderr)
            return 2
        idx = load(root)
        t = time.time()
        vectors(root, idx, emb)
        print(f"vectors for {emb.model}: {len(idx['secs'])} sections ({time.time() - t:.0f} s)")
        return 0
    if not a.query:
        ap.error("a query, or --build-vectors")
    info = {}
    try:
        hits = search(load(root), " ".join(a.query), a.k, include_superseded=not a.current, mode=a.mode, root=root,
                      build=False, info=info)
    except RuntimeError as e:
        print(e, file=sys.stderr)
        return 2
    if info.get("fallback"):
        print(f"(임베딩 색인 준비 중이라 BM25로 찾음: {info['fallback']})", file=sys.stderr)
    if a.json:
        print(json.dumps(hits, ensure_ascii=False, indent=1))
        return 0
    if not hits:
        print("찾은 곳 없음: 문서에서 확인되지 않습니다 (추측으로 채우지 말 것)")
        return 1
    for h in hits:
        tag = f"[{h['layer']}{', ' + h['status'] if h['status'] else ''}{', 대체됨 → ' + h['superseded_by'] if h['superseded_by'] else ''}]"
        name = f"{h['id']} " if h["id"] else ""
        print(f"{h['path']}:{h['lines'][0]}-{h['lines'][1]}  {name}{h['head'] or h['title']}  {tag}  ({h['via']} {h['score']})")
        print(f"    {h['snippet']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
